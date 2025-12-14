const express = require('express');
const axios = require('axios');
const router = express.Router();
const pLimit = require('p-limit').default;

require('dotenv').config();
const SERVICE_KEY = process.env.TOUR_API_SERVICE_KEY;
const BASE = process.env.TOUR_API_BASE || 'http://apis.data.go.kr/B551011/KorService2';
if (!SERVICE_KEY) console.warn('⚠️ TOUR_API_SERVICE_KEY is missing');

// 캐시
const courseCache = new Map(); // key: contentid, value: courseData
const placeCache = new Map();  // key: subcontentid, value: merged placeData

// 동시 호출 제한
const limit = pLimit(10);

// Axios 인스턴스 (timeout + 재시도 방지)
const axiosInstance = axios.create({
  timeout: 5000, // 8초 이상 지연 시 자동 실패 처리
});

router.get('/course', async (req, res) => {
  console.log(`🟡 [COURSE] 요청 시작`, req.query);

  try {
    // 1️⃣ course 리스트 가져오기
    const listRes = await axiosInstance.get('http://apis.data.go.kr/B551011/KorService2/areaBasedList2', {
      params: {
        ServiceKey: SERVICE_KEY,
        _type: 'json',
        pageNo: 1,
        MobileOS: 'ETC',
        MobileApp: 'AppTest',
        arrange: 'Q',
        areaCode: '1',
        contentTypeId: 25,
        numOfRows: req.query.numOfRows || 20,
      },
    });

    const courses = Array.isArray(listRes.data?.response?.body?.items?.item)
      ? listRes.data.response.body.items.item
      : [listRes.data?.response?.body?.items?.item].filter(Boolean);

    // 2️⃣ 코스별 처리
    const courseResults = await Promise.allSettled(
      courses.map(async (course) => {
        const { contentid,contenttypeid, title, firstimage } = course;

        // 캐시 확인
        if (courseCache.has(contentid)) {
          console.log(`🟢 캐시 사용 courseId: ${contentid}`);
          return courseCache.get(contentid);
        }

        try {
          // 3️⃣ overview 가져오기
          let overview = null;
          try {
            const overviewRes = await axiosInstance.get('http://apis.data.go.kr/B551011/KorService2/detailCommon2', {
              params: {
                contentId: contentid,
                ServiceKey: SERVICE_KEY,
                _type: 'json',
                MobileOS: 'ETC',
                MobileApp: 'AppTest',
              },
            });

            let item = overviewRes.data?.response?.body?.items?.item;
            if (Array.isArray(item)) item = item[0];
            overview = item?.overview ?? null;
          } catch (err) {
            console.warn(`⚠️ overview 실패 contentid=${contentid}:`, err.message);
          }

          // 4️⃣ places 가져오기
          let places = [];
          try {
            const detailRes = await axiosInstance.get('http://apis.data.go.kr/B551011/KorService2/detailInfo2', {
              params: {
                contentId: contentid,
                contentTypeId: 25,
                ServiceKey: SERVICE_KEY,
                _type: 'json',
                MobileOS: 'ETC',
                MobileApp: 'AppTest',
              },
            });

            places = detailRes.data?.response?.body?.items?.item;
            if (!Array.isArray(places)) places = [places].filter(Boolean);
          } catch (err) {
            console.warn(`⚠️ places 목록 실패 contentid=${contentid}:`, err.message);
          }

          // 5️⃣ 각 place의 상세(map, tel 등) 병렬 처리
          const placeResults = await Promise.allSettled(
            places.map((place) =>
              limit(async () => {
                const subcontentid = place.subcontentid;
                if (!subcontentid) return null;

                // 캐시 확인
                if (placeCache.has(subcontentid)) return placeCache.get(subcontentid);

                try {
                  const mapRes = await axiosInstance.get('http://apis.data.go.kr/B551011/KorService2/detailCommon2', {
                    params: {
                      contentId: subcontentid,
                      ServiceKey: SERVICE_KEY,
                      _type: 'json',
                      MobileOS: 'ETC',
                      MobileApp: 'AppTest',
                    },
                  });

                  let mapRaw = mapRes.data?.response?.body?.items?.item;
                  if (Array.isArray(mapRaw)) mapRaw = mapRaw[0];

                  const mergedPlace = {
                    ...place,
                    mapx: mapRaw?.mapx ?? null,
                    mapy: mapRaw?.mapy ?? null,
                    tel: mapRaw?.tel ?? null,
                    homepage: mapRaw?.homepage ?? null,
                    firstimage: mapRaw?.firstimage ?? null,
                    addr1: mapRaw?.addr1 ?? null,
                    addr2: mapRaw?.addr2 ?? null,
                  };

                  placeCache.set(subcontentid, mergedPlace);
                  return mergedPlace;
                } catch (err) {
                  console.warn(`❌ place 실패 subcontentid=${subcontentid}:`, err.message);
                  const mergedPlace = { ...place };
                  placeCache.set(subcontentid, mergedPlace);
                  return mergedPlace;
                }
              })
            )
          );

          const placesWithMap = placeResults
            .filter((r) => r.status === 'fulfilled')
            .map((r) => r.value)
            .filter(Boolean);

          // 6️⃣ 최종 courseData 생성
          const courseData = { contentid,contenttypeid, title, firstimage, overview, places: placesWithMap };
          courseCache.set(contentid, courseData);
          return courseData;
        } catch (err) {
          console.warn(`❌ 코스 처리 실패 contentid=${course.contentid}:`, err.message);
          const courseData = { contentid,contenttypeid, title, firstimage, overview: null, places: [] };
          courseCache.set(contentid, courseData);
          return courseData;
        }
      })
    );

    // 성공한 코스만 반환
    const result = courseResults
      .filter((r) => r.status === 'fulfilled')
      .map((r) => r.value);

    res.json(result);
  } catch (err) {
    console.error('🔥 전체 요청 실패:', err.message);
    res.status(500).json({ error: 'API 호출 실패', details: err.message });
  }
});

module.exports = router;