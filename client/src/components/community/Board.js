import React, { useContext, useEffect, useRef, useState, useCallback } from 'react';
import AddBoard from './AddBoard';
import BoardList from './BoardList';
import '../../index.css';
import BoardSearch from './BoardSearch';
import { Box, CircularProgress, Tab, Tabs } from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import { BoardContext } from './BoardContext';

/**
 * 변경사항 요약
 * - BoardSearch가 전달하는 payload(author/when/cond)를 평탄화하여 filters에 저장.
 * - 서버로는 authorGender/authorAge[], startDate/endDate, condGender/condAge[]/condType[]로 전달.
 */

const Board = ({ rightRef, scrollRef }) => {
  const {
    boardList,
    loading,
    setBoardList,
    onListData,
    error,
    skip,
    setSkip,
    limit,
    setLoading,
    setImages,
    modalOpen,
  } = useContext(BoardContext);

  const [hasMore, setHasMore] = useState(true);
  const [filters, setFilters] = useState({});
  const [searchKey, setSearchKey] = useState('subject');

  const location = useLocation();
  const history = useNavigate();
  const query = new URLSearchParams(location.search);
  const fetchingRef = useRef(false);

  const cat = query.get('cat') || 'mate';

  const handleTabChange = (_, value) => {
    const newQuery = new URLSearchParams();
    newQuery.set('cat', value);
    history({ search: `?${newQuery.toString()}` });
    // 탭 바꾸면 첫 페이지부터 다시
  };

  const [keyword, setKeyword] = useState('');
  const [sort, setSort] = useState('desc');

  // 필터/카테고리/모달 변화 시 리스트 초기화
  useEffect(() => {
    setBoardList([]);
    setSkip(0);
    setHasMore(true);
  }, [cat, modalOpen, JSON.stringify(filters),sort,keyword]);

  const loadMore = useCallback(
    async (baseSkip, curCat) => {
      if (loading || fetchingRef.current) return;
      if (!hasMore) return

      fetchingRef.current = true;
      setLoading(true);
      try {
        const params = {
          ...filters,
          cat: curCat,
          skip: baseSkip,
          limit,
          sort,
          searchKey,
          include: 'cover',
          ...(keyword? {keyword} : {})
        };
        const { boardListData = [] } = await onListData(params);

        if (boardListData.length > 0) {
          setBoardList((prev) => [...prev, ...boardListData]);
        } else if (baseSkip === 0) {
          setBoardList([]);
        }

        setSkip((prev) => prev + boardListData.length);
        setHasMore(boardListData.length === limit);
      } catch (e) {
        console.error(e);
        setHasMore(false);
      } finally {
        setLoading(false);
        fetchingRef.current = false;
      }
    },
    [limit, hasMore, loading, onListData, setBoardList, setLoading, setSkip, filters, sort, searchKey]
  );

  useEffect(() => {
    if (skip === 0 && hasMore && !loading) {
      loadMore(0, cat);
    }
  }, [modalOpen, skip, hasMore, loading, cat, loadMore]);

  useEffect(() => {
    const el = scrollRef?.current;
    if (!el) return;
    const handleScroll = () => {
      if (!loading && hasMore && el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
        loadMore(skip, cat);
      }
    };
    el?.addEventListener('scroll', handleScroll);
    return () => el?.removeEventListener('scroll', handleScroll);
  }, [scrollRef, loadMore, skip, cat]);

  useEffect(() => {
    if (loading) return;
    const el = scrollRef?.current;
    if (!el || !hasMore) return;
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 120;
    if (nearBottom) loadMore(skip, cat);
  }, [loading, hasMore, skip, cat, loadMore, scrollRef?.current]);


  /**
   * BoardSearch → onSearch(payload) 평탄화
   * payload = { author:{gender,ages[]}, when:{startDate,endDate}, cond:{gender,ages[] (string), types[]}, keyword, topic }
   */
  const handleSearch = (f) => {
    const next = {
      topic: f.topic,
      // 작성자 필터
      authorGender: f.author?.gender || undefined,
      authorAge: Array.isArray(f.author?.ages) && f.author.ages.length > 0 ? f.author.ages : undefined, // [20,30]
      // 여행일정
      startDate: f.when?.startDate ? new Date(f.when.startDate).toISOString() : undefined,
      endDate: f.when?.endDate ? new Date(f.when.endDate).toISOString() : undefined,
      // 동행조건 (글의 mateCondition.*)
      condGender: f.cond?.gender || undefined,
      condAge: Array.isArray(f.cond?.ages) && f.cond.ages.length > 0 ? f.cond.ages : undefined, // ["20","30"] 문자열 배열
      condType: Array.isArray(f.cond?.types) && f.cond.types.length > 0 ? f.cond.types : undefined, // ["식사동행", ...]
    };
    setFilters(next);
    if(f.sort) setSort(f.sort)
    if(f.keyword) setKeyword(f.keyword?.trim() || '')
  };

  return (
    <Box sx={{ width: '100%', maxWidth: 880, mx: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box>
        <Tabs
          value={cat}
          onChange={handleTabChange}
          textColor="inherit"
          indicatorColor="primary"
          sx={{
            '& .MuiTab-root': {
              color: 'gray',
              fontWeight: 'bold',
              fontSize: 18,
            },
            '& .Mui-selected': {
              color: '#20b2aa !important',
            },
            '& .MuiTabs-indicator': {
              background: 'none',
            },
          }}
        >
          <Tab value="mate" label="동행" />
          <Tab value="post" label="포스트" />
        </Tabs>
      </Box>

      <BoardSearch cat={cat} onSearch={handleSearch} />

      <Box sx={{ flex: 1, minHeight: 0, mt: 1 }}>
        {loading && boardList.length === 0 ? (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <CircularProgress sx={{ color: '#20b2aa' }} />
          </Box>
        ) : (
          <BoardList cat={cat} />
        )}
      </Box>
    </Box>
  );
};

export default Board;
