// /routers/adminRouter.js
require('dotenv').config();
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const fs = require('fs')
const multer = require('multer')
const path = require('path')

// uploads 폴더 확인
try {
    fs.readdirSync('uploads');
} catch (error) {
    fs.mkdirSync('uploads');
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads"),
  filename: (req, file, cb) =>
    cb(null, Date.now().toString() + path.extname(file.originalname)),
});
const uploads = multer({ storage });


// ✅ 프로젝트 모델에 맞게 조정
const Member = require('../models/memberSchema')


const Image = mongoose.model('image')
const EventAd = mongoose.model('event_ad');

// 아래 모델들은 프로젝트에 있으면 사용, 없으면 주석 처리/교체
let Board, Review, Report, Inquiry;
try { Board = mongoose.model('board'); } catch {}
try { Review = mongoose.model('reviewdbs'); } catch {}
try { Report = mongoose.model('report'); } catch {}
try { Inquiry = mongoose.model('inquiry'); } catch {}

// ─────────────────────────────────────────────────────────────
// 공통: 관리자 권한 확인 미들웨어
// ─────────────────────────────────────────────────────────────
function adminOnly(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ message: '토큰 없음' });

  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== 'admin') {
      return res.status(403).json({ message: '관리자 권한이 필요합니다.' });
    }
    req.userId = payload.userId;
    req.jwt = payload;
    next();
  } catch (err) {
    return res.status(403).json({ message: '유효하지 않은 토큰' });
  }
}

// 모든 라우트에 관리자 보호 적용
//관리자전용이라서 항상 관리자토큰이 필요함.
router.use(adminOnly);

// ─────────────────────────────────────────────────────────────
// 1. 공지사항 관리 (공지글: Board 컬렉션 재사용 가정)
// ─────────────────────────────────────────────────────────────

// 목록 (카테고리/키워드/고정 여부/공개범위)
router.get('/notices', async (req, res) => {
  try {
    const notices = await Board.find({ boardType: 'notice' })
      .sort({ created: -1 })
      .select('subject userId cat pinTop highlight created');
    
    res.json({ list: notices });
  } catch (err) {
    console.error('공지 목록 조회 실패:', err);
    res.status(500).json({ message: '공지 목록을 불러오지 못했습니다.' });
  }
});

//공지생성
router.post("/notice",uploads.array("upload", 10), async (req, res) => {
    try {
      console.log('back notice');
      
      const token = req.headers.authorization?.split(" ")[1];
      if (!token) return res.status(401).json({ message: "토큰 없음" });

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const userId = decoded.userId;

      // 관리자 정보 가져오기 (닉네임/성별/나이대)
      const admin = await Member.findOne({ userId });
      if (!admin) return res.status(404).json({ message: "관리자 정보 없음" });

      const body = JSON.parse(req.body.board || "{}");
      const defaultImageUrl = req.body.defaultImageUrl;

      // 공지 번호 자동 생성
      const latest = await Board.findOne().sort({ numBrd: -1 }).lean();
      const newNum = latest ? latest.numBrd + 1 : 1;

      const payload = {
        ...body,
        numBrd: newNum,
        userId: admin.userId,
        boardType: "notice",
        nickname: admin.nickname,
        gender: admin.gender,
        ageRange: admin.ageRange,
      };

      const board = await Board.create(payload);

      const files = req.files || [];
      if (files.length > 0) {
        await Image.create({
          numBrd: newNum,
          images: files.map((f) => ({
            originalFileName: f.originalname,
            saveFileName: f.filename,
            path: `${process.env.BASE_URL}/uploads/${f.filename}`,
          })),
        });
      } else if (defaultImageUrl) {
        await Image.create({
          numBrd: newNum,
          images: [
            {
              originalFileName: "default",
              saveFileName: "default",
              path: defaultImageUrl,
            },
          ],
        });
      }

      return res.status(200).json({ message: "공지 등록 완료" });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "서버 오류" });
    }
  }
);

// 수정
router.put('/notices/:id', async (req, res) => {
  if (!Board) return res.status(500).json({ message: 'Board 모델이 없습니다.' });

  const { id } = req.params;
  const patch = (({ subject, content, cat, pinTop, highlight }) =>
    ({ subject, content, cat, pinTop, highlight }))(req.body);

  try {
    const updated = await Board.findByIdAndUpdate(id, patch, { new: true });
    if (!updated) return res.status(404).json({ message: '공지 없음' });
    res.json({ message: '공지 수정 완료', notice: updated });
  } catch (err) {
    res.status(500).json({ message: '공지 수정 오류', error: String(err) });
  }
});

// 삭제
router.delete('/notices/:id', async (req, res) => {
  if (!Board) return res.status(500).json({ message: 'Board 모델이 없습니다.' });

  const { id } = req.params;
  try {
    const r = await Board.findByIdAndDelete(id);
    if (!r) return res.status(404).json({ message: '공지 없음' });
    res.json({ message: '공지 삭제 완료' });
  } catch (err) {
    res.status(500).json({ message: '공지 삭제 오류', error: String(err) });
  }
});

// ─────────────────────────────────────────────────────────────
// 2. 회원 관리
// ─────────────────────────────────────────────────────────────

// 목록 + 검색/필터
router.get('/members', async (req, res) => {
  const { keyword, email, nickname, from, to, skip = 0, limit = 20 } = req.query;

  const q = {};
  if (email) q.email = { $regex: email, $options: 'i' };
  if (nickname) q.nickname = { $regex: nickname, $options: 'i' };
  if (keyword) {
    q.$or = [
      { email: { $regex: keyword, $options: 'i' } },
      { nickname: { $regex: keyword, $options: 'i' } },
      { userId: { $regex: keyword, $options: 'i' } }
    ];
  }
  // 가입일 범위
  if (from || to) {
    q.created = {};
    if (from) q.created.$gte = new Date(from);
    if (to) q.created.$lte = new Date(to);
  }

  try {
    const list = await Member.find(q)
      .select('userId nickname email role created lastLogin status')
      .sort('-created')
      .skip(Number(skip))
      .limit(Number(limit));
    const total = await Member.countDocuments(q);
    res.json({ list, total });
  } catch (err) {
    res.status(500).json({ message: '회원 목록 오류', error: String(err) });
  }
});

// 상세
router.get('/members/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const m = await Member.findById(id);
    if (!m) return res.status(404).json({ message: '회원 없음' });

    // TODO: 작성 글/댓글/활동내역 join or 별도 조회
    res.json({ member: m, posts: [], comments: [], activities: [] });
  } catch (err) {
    res.status(500).json({ message: '회원 상세 오류', error: String(err) });
  }
});

//회원아이디 상세(SectionMembers에서 사용)
router.get('/members/:id/detail', async (req, res) => {
  try {
    const memberId = req.params.id;
    const member = await Member.findById(memberId).select('userId nickname email created lastLogin status')
    if(!member) return res.status(404).json({message: '유저를 찾을 수 없습니다.'})

    const Board = mongoose.model('board');
    const Review = mongoose.model('review');

    const boards = await Board.find({ userId: member.userId})
      .select('numBrd subject boardType created')
      .sort({created: -1})
      .limit(10);

    const reviews = await Review.find({userId: member.userId})
      .select('content created numBrd')
      .sort({created: -1})
      .limit(10)

    res.json({member, boards, reviews})
    } catch (err) {
      console.error('회원 상세 조회 실패:', err);
      res.status(500).json({message: '서버 오류'})
  }
})

// 제재: 경고/정지/영구차단 등 (간단한 status 필드 예시)
router.post('/members/:id/punish', async (req, res) => {
  const { id } = req.params;
  const { type, reason } = req.body; // 'warn' | 'suspend' | 'ban'
  try {
    const m = await Member.findById(id);
    if (!m) return res.status(404).json({ message: '회원 없음' });

    // 프로젝트 정책대로 상태 필드/이력 필드 업데이트
    // 예: m.status = 'suspended'; m.punishLogs.push({ type, reason, date: new Date() });
    m.status = type;
    await m.save();

    res.json({ message: '제재 처리 완료', member: m });
  } catch (err) {
    res.status(500).json({ message: '제재 처리 오류', error: String(err) });
  }
});

// 비밀번호 초기화 메일 재발송(예시, 실제 메일 로직은 auth.js 참고해서 연결)
router.post('/members/:id/reset-password', async (req, res) => {
  // TODO: 임시 비밀번호 생성 + 메일 발송 + 비번 갱신
  res.json({ message: '비밀번호 초기화 메일 발송(예시)' });
});

// 인증 메일 재발송
router.post('/members/:id/resend-email', async (req, res) => {
  // TODO: 이메일 재발송 로직
  res.json({ message: '인증 메일 재발송(예시)' });
});

// ─────────────────────────────────────────────────────────────
// 3. 게시물/댓글 관리
// ─────────────────────────────────────────────────────────────

// 게시글 목록
router.get('/posts', async (req, res) => {
  if (!Board) return res.status(500).json({ message: 'Board 모델이 없습니다.' });
  const { sort='-created' } = req.query;

  const q = {};
  if (board) q.cat = board;
  if (keyword) {
    q.$or = [
      { subject: { $regex: keyword, $options: 'i' } },
      { content: { $regex: keyword, $options: 'i' } }
    ];
  }

  try {
    const list = await Board.find({ boardType:'notice' }).sort(sort);
    const total = await Board.countDocuments(q);
    res.json({ list, total });
  } catch (err) {
    res.status(500).json({ message: '게시글 목록 오류', error: String(err) });
  }
});

// 게시글 숨김
router.post('/posts/:id/hide', async (req, res) => {
  const {id} = req.params;
  const update = await Board.findByIdAndUpdate(id, {hidden: true}, {new: true})
  res.json({ok: true, hidden:update.hidden})
})
//게시글 숨긴거 보이기
router.post('/posts/:id/unhide', async (req, res) => {
  const {id} = req.params;
  const update = await Board.findByIdAndUpdate(id, {hidden: false}, {new: true})
  res.json({ok: true, hidden:update.hidden})
})


//게시글 삭제
router.delete('/posts/:id', async (req, res) => {
  if (!Board) return res.status(500).json({ message: 'Board 모델이 없습니다.' });
  const { id } = req.params;
  try {
    const r = await Board.findByIdAndDelete(id);
    if (!r) return res.status(404).json({ message: '게시글 없음' });
    res.json({ message: '삭제 완료' });
  } catch (err) {
    res.status(500).json({ message: '삭제 오류', error: String(err) });
  }
});



//ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ
// 4. 댓글 관리
//ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ

// 댓글(선택) 목록/삭제: Comment 모델이 있을 때만
router.get('/reviews', async (req, res) => {
  
  if (!Review) return res.json({ list: [], total: 0 });
  const { keyword, skip = 0, limit = 20 } = req.query;

  const q = {};
  if (keyword) q.content = { $regex: keyword, $options: 'i' };

  try {
    const list = await Review.find(q).sort('-created').skip(Number(skip)).limit(Number(limit));
    const total = await Review.countDocuments(q);
    res.json({ list, total });
  } catch (err) {
    res.status(500).json({ message: '댓글 목록 오류', error: String(err) });
  }
});

router.delete('/reviews/:id', async (req, res) => {
  if (!Review) return res.status(500).json({ message: 'Review 모델이 없습니다.' });
  const { id } = req.params;
  try {
    const r = await Review.findByIdAndDelete(id);
    if (!r) return res.status(404).json({ message: '댓글 없음' });
    res.json({ message: '삭제 완료' });
  } catch (err) {
    res.status(500).json({ message: '삭제 오류', error: String(err) });
  }
});

// 댓글 숨김
router.post('/reviews/:id/hide', async (req, res) => {
  if (!Review) { 
    return res.status(500).json({ message: 'Review 모델이 없습니다.' });
  }
  console.log('dddd')
  try {
    const { id } = req.params;
    const update = await Review.findByIdAndUpdate(id, { hidden: true }, { new: true });
    if (!update) return res.status(404).json({ message: '댓글 없음' });
    res.json({ ok: true, hidden: true });
  } catch (err) {
    console.error('댓글 숨김 처리 오류:', err);
    res.status(500).json({ message: '댓글 숨김 처리 오류', error: err.message });
  }
});

// 댓글 숨김 해제
router.post('/reviews/:id/unhide', async (req, res) => {
  if (!Review) {
    return res.status(500).json({ message: 'Review 모델이 없습니다.' });
  }
  
  try {
    const { id } = req.params;
    const update = await Review.findByIdAndUpdate(id, { hidden: false }, { new: true });
    if (!update) return res.status(404).json({ message: '댓글 없음' });
    res.json({ ok: true, hidden: false });
  } catch (err) {
    console.error('댓글 숨김 해제 오류:', err);
    res.status(500).json({ message: '댓글 숨김 해제 오류', error: err.message });
  }
})

// 광고 목록 조회
router.get('/ad/event-ads', async (req, res) => {
  try {
    const ads = await EventAd.find().sort({ priority: 1 });
    res.json({ list: ads });
  } catch (err) {
    console.error('이벤트 광고 목록 조회 실패:', err);
    res.status(500).json({ message: '이벤트 광고 목록 조회 실패', error: err.message });
  }
});

// 광고 등록 / 업데이트 (upsert)
router.post('/ad/event-ads', async (req, res) => {
  try {
    const {
      title, contenttypeid, contentid, addr1, addr2, tel,
      mapx, mapy, eventstartdate, eventenddate,
      firstimage, overview, active, priority, link
    } = req.body;

    if (!contentid) return res.status(400).json({ message: 'contentid 필수' });

    const updated = await EventAd.findOneAndUpdate(
      { contentid },
      {
        title, contenttypeid, addr1, addr2, tel,
        mapx, mapy, eventstartdate, eventenddate,
        firstimage, overview, active, priority, link
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(201).json({ message: '광고 등록/업데이트 완료', ad: updated });
  } catch (err) {
    console.error('광고 등록 실패:', err);
    res.status(500).json({ message: '광고 등록 실패', error: err.message });
  }
});

// 광고 활성/비활성 토글
router.post('/ad/event-ads/:contentid/toggle', async (req, res) => {
  const { contentid } = req.params;
  try {
    if (!contentid) return res.status(400).json({ message: 'contentid 필요' });

    const ad = await EventAd.findOne({ contentid });
    if (!ad) return res.status(404).json({ message: '광고 없음' });

    ad.active = !ad.active;
    await ad.save();

    res.json({ message: '토글 완료', active: ad.active });
  } catch (err) {
    console.error('광고 토글 실패:', err);
    res.status(500).json({ message: '광고 토글 실패', error: err.message });
  }
});


module.exports = router;
