const express = require('express');
const axios = require('axios');
const pLimit = require('p-limit').default;
const router = express.Router();

require('dotenv').config();
const SERVICE_KEY = process.env.TOUR_API_SERVICE_KEY;
const BASE = process.env.TOUR_API_BASE || 'http://apis.data.go.kr/B551011/KorService2';
if (!SERVICE_KEY) console.warn('⚠️ TOUR_API_SERVICE_KEY is missing');

const axiosInstance = axios.create({ timeout: 10000 });
const detailCache = new Map(); // contentId 별 상세 데이터 캐시
const itemsCache = new Map();  // 목록(items) 캐시

const getToday = () => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
};

// ✅ 공통 리스트 조회
const fetchList = async ({ api, params }) => {
  const res = await axiosInstance.get(api, { params: { ServiceKey: SERVICE_KEY, _type: 'json', ...params } });
  let items = res.data?.response?.body?.items?.item || [];
  if (!Array.isArray(items)) items = [items];
  return items;
};

// ✅ 공통 상세 조회
const fetchDetail = async (contentid) => {
  try {
    const res = await axiosInstance.get(`${BASE}/detailCommon2`, {
      params: { ServiceKey: SERVICE_KEY, MobileOS: 'ETC', MobileApp: 'AppTest', _type: 'json', contentId: contentid },
    });
    let item = res.data?.response?.body?.items?.item || {};
    if (Array.isArray(item)) item = item[0];
    return item;
  } catch (err) {
    console.error(`❌ fetchDetail(${contentid}) 실패:`, err.message);
    return {};
  }
};

// ✅ 캐시 적용된 fetchDetail
const fetchDetailCached = async (contentid) => {
  if (detailCache.has(contentid)) return detailCache.get(contentid);
  const detail = await fetchDetail(contentid);
  detailCache.set(contentid, detail);
  return detail;
};

// ✅ 공통 데이터 병합 (병렬 제한 + 실패 무시)
const limit = pLimit(20);
const mergeData = async (items) => {
  const promises = items.map(item =>
    limit(async () => {
      if (!item.contentid) return { ...item, overview: '', homepage: '' };
      try {
        const detail = await fetchDetailCached(item.contentid);
        return {
          ...item,
          overview: detail.overview || '',
          homepage: detail.homepage || '',
          firstimage: detail.firstimage || item.firstimage || '',
          firstimage2: detail.firstimage2 || item.firstimage2 || '',
        };
      } catch (err) {
        console.error(`❌ mergeData 실패 contentid=${item.contentid}`, err.message);
        return { ...item, overview: '', homepage: '', firstimage: item.firstimage || '', firstimage2: item.firstimage2 || '' };
      }
    })
  );
  return await Promise.all(promises);
};

// ✅ 범용 라우터 (items + detail 캐시 적용)
router.get('/:type', async (req, res) => {
  const { type } = req.params;
  const { numOfRows = 20, pageNo = 1 } = req.query;
  const today = getToday();

  const apiMap = {
    event: 'http://apis.data.go.kr/B551011/KorService2/searchFestival2',
    stay: 'http://apis.data.go.kr/B551011/KorService2/searchStay2',
    trip: 'http://apis.data.go.kr/B551011/KorService2/areaBasedList2',
    food: 'http://apis.data.go.kr/B551011/KorService2/areaBasedList2',
    cafe: 'http://apis.data.go.kr/B551011/KorService2/areaBasedList2',
    culture: 'http://apis.data.go.kr/B551011/KorService2/areaBasedList2',
    leisure: 'http://apis.data.go.kr/B551011/KorService2/areaBasedList2',
    shop: 'http://apis.data.go.kr/B551011/KorService2/areaBasedList2',
  };

  const api = apiMap[type];
  if (!api) return res.status(400).json({ error: 'invalid type' });

  const cacheKey = `${type}_${pageNo}_${numOfRows}`;
  if (itemsCache.has(cacheKey)) {
    return res.json(itemsCache.get(cacheKey));
  }

  try {
    const items = await fetchList({
      api,
      params: {
        numOfRows,
        pageNo,
        MobileOS: 'ETC',
        MobileApp: 'AppTest',
        arrange: 'Q',
        areaCode: '1',
        ...(type === 'event' ? { eventStartDate: today } : {}),
        ...(type === 'trip' ? { contentTypeId: 12 } : {}),
        ...(type === 'food' ? { contentTypeId: 39 } : {}),
        ...(type === 'cafe' ? { contentTypeId: 39, cat1:'A05', cat2:'A0502', cat3:'A05020900'} : {}),
        ...(type === 'culture' ? { contentTypeId: 14 } : {}),
        ...(type === 'leisure' ? { contentTypeId: 28 } : {}),
        ...(type === 'shop' ? { contentTypeId: 38 } : {}),
      },
    });

    if (!items.length) return res.json([]);

    const merged = await mergeData(items);
    itemsCache.set(cacheKey, merged); // 캐시에 저장
    res.json(merged);
  } catch (err) {
    console.error('❌ API 호출 실패:', err.message);
    res.status(500).json({ error: 'API 호출 실패' });
  }
});

module.exports = router;