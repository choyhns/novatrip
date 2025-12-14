const express = require('express');
const router = express.Router();

// mongoose 모델 import
const TripBookmark = require('../models/tripBookmarkSchema');
const TripGood = require('../models/tripGoodsSchema');
require('../models/boardSchema');
const mongoose = require('mongoose');
const Board = mongoose.model('board');


// 🎯 즐겨찾기 조회
router.get('/bookmark/:userid', async (req, res) => {
  try {
    const myBookmark = await TripBookmark.find({ userid: req.params.userid });
    res.json({ myBookmark }); // { myBookmark: [...] }
  } catch (error) {
    console.error('❌ 북마크 조회 실패:', error);
    res.status(500).json({ error: '서버 오류로 북마크를 불러올 수 없습니다.' });
  }
});

// 🎯 찜 목록 조회
router.get('/good/:userid', async (req, res) => {
  try {
    const myGood = await TripGood.find({ userid: req.params.userid });
    res.json({ myGood });
  } catch (error) {
    console.error('❌ 찜 목록 조회 실패:', error);
    res.status(500).json({ error: '서버 오류로 찜 목록을 불러올 수 없습니다.' });
  }
});

// 🎯 게시글 조회
router.get('/boards/:userid', async (req, res) => {
  try {
    const myBoards = await Board.find({ userId: req.params.userid });
    res.json({ myBoards });
  } catch (error) {
    console.error('❌ 게시글 조회 실패:', error);
    res.status(500).json({ error: '서버 오류로 게시글을 불러올 수 없습니다.' });
  }
});

module.exports = router;
