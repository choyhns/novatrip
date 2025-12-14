require('dotenv').config();
const express = require('express');
// const router = express.Router(); // ← 사용하지 않으므로 제거해도 됨(무해)
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const multer = require('multer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const KAKAO_REST_API_KEY = process.env.KAKAO_REST_API_KEY;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const REDIRECT_URI = 'http://localhost:8080/login/auth/kakao/callback';

// 회원탈퇴에 필요함.
const { Board, Image, Good, Share } = require('../models/boardSchema');
require('../models/reviewSchema'); // 모델 등록 (reviewdbs)
const Review = mongoose.model('reviewdbs');
const TripGood = require('../models/tripGoodsSchema');
const TripBookmark = require('../models/tripBookmarkSchema');

// 스키마 가져오기
const Member = require('../models/memberSchema');
const { log } = require('console');

// JWT(토큰) 인증 미들웨어
function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ message: '토큰 없음' });

    const token = authHeader.split(' ')[1]; // Bearer <token>
    if (!token) return res.status(401).json({ message: '토큰 없음' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId; // req에서 사용자 식별
    next();
  } catch (err) {
    return res.status(403).json({ message: '유효하지 않은 토큰' });
  }
}

module.exports = (app) => {
  // ─────────────────────────────────────────────────────────────
  // 소셜 로그인 (카카오)
  // ─────────────────────────────────────────────────────────────
// GET /login/auth/kakao
app.get('/login/auth/kakao', (req, res) => {
  const scope = [
    'profile_nickname',
    'profile_image',
    'account_email',
    'name',
    'gender',
    'age_range',
  ].join(',');

  const kakaoAuthURL =
    `https://kauth.kakao.com/oauth/authorize` +
    `?client_id=${KAKAO_REST_API_KEY}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code` +
    `&scope=${scope}`;

  res.redirect(kakaoAuthURL);
});

//ageRange함수 (20대,30대로 만들기)
function toKoreanDecadeLabel(kakaoAgeRange) {
  if (!kakaoAgeRange) return '';
  const m = /^(\d+)\s*~\s*(\d+)$/.exec(kakaoAgeRange);
  if (!m) return kakaoAgeRange; // 예상치 못한 형식이면 원문 그대로
  const start = parseInt(m[1], 10);
  if (!Number.isFinite(start)) return kakaoAgeRange;

  // 10대 미만 처리(원하면 '0대'로 바꿔도 됨)
  if (start < 10) return '10대 미만';

  // 20~29 -> 20대, 30~39 -> 30대 ...
  return `${Math.floor(start / 10) * 10}대`;
}

app.get('/login/auth/kakao/callback', async (req, res) => {
  const { code } = req.query;
  try {
    // 토큰 발급
    const tokenResponse = await axios.post(
      'https://kauth.kakao.com/oauth/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: KAKAO_REST_API_KEY,
        redirect_uri: REDIRECT_URI,
        code,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const accessToken = tokenResponse.data.access_token;

    // 사용자 정보 조회
    const me = await axios.get('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    function randomNicknames() {
      const words = ['물티슈','죠르디','마테우스','보아탱','크샨테','알리','제임스','마이클','캐빈','텀블러'];
      const w = words[Math.floor(Math.random() * words.length)];
      const n = String(Math.floor(Math.random() * 100)).padStart(2, '0');
      return w + n;
    }

    const kakaoId = me.data.id;
    const account = me.data.kakao_account || {};
    const profile = account.profile || {};

    // ⚡️ 여기서 실제 값 매핑
    const nickname =
      profile.nickname ||
      me.data.properties?.nickname || // 예전 키(있을 수도 있음)
      randomNicknames();

    const profileImage =
      profile.profile_image_url || profile.thumbnail_image_url || '';

    // 이메일은 유효/인증 여부 체크 권장
    const email =
      account.is_email_valid && account.is_email_verified
        ? (account.email || '')
        : '';

    const name = account.name || '';
    const gender = account.gender || '';       // 'male' | 'female'
    const rawAgeRange = account.age_range;
    const ageRange = toKoreanDecadeLabel(rawAgeRange)  // 예: 20대

    // 필요하면 '추가 동의 필요' 플래그 보고 재동의 유도 가능
    const needScopes = [];
    if (account.profile_nickname_needs_agreement) needScopes.push('profile_nickname');
    if (account.profile_image_needs_agreement)    needScopes.push('profile_image');
    if (account.email_needs_agreement)            needScopes.push('account_email');
    if (account.name_needs_agreement)             needScopes.push('name');
    if (account.gender_needs_agreement)           needScopes.push('gender');
    if (account.age_range_needs_agreement)        needScopes.push('age_range');

    if (needScopes.length) {
      const reconsent = `https://kauth.kakao.com/oauth/authorize` +
        `?client_id=${KAKAO_REST_API_KEY}` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&response_type=code&scope=${needScopes.join(',')}`;
      return res.redirect(reconsent); // 추가 동의 요청
    }

    // 가입/로그인 처리
    let user = await Member.findOne({ oauthProvider: 'kakao', oauthId: kakaoId });
    if (!user) {
      user = new Member({
        userId: `kakao_${kakaoId}`,
        nickname,
        email,
        name,
        gender,
        ageRange,
        profileImage,
        enabled: true,
        pwd: '',
        oauthProvider: 'kakao',
        oauthId: kakaoId,
        tempPwd: false,
      });
    } else {
      // 기존 유저 보강 저장(비어있는 값만 채우기)
      if (!user.nickname)     user.nickname = nickname;
      if (!user.email)        user.email = email;
      if (!user.name)         user.name = name;
      if (!user.gender)       user.gender = gender;
      if (!user.ageRange)     user.ageRange = ageRange;
      if (!user.profileImage) user.profileImage = profileImage;
    }
    await user.save();

    // JWT 발급 및 부모 창으로 전달
    const token = jwt.sign(
      { _id: user._id,userId: user.userId, nickname: user.nickname },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.send(`
      <html><body><script>
        window.opener.postMessage({ token: "${token}", nickname: "${user.nickname}" }, "${FRONTEND_URL}");
        window.close();
      </script></body></html>
    `);
  } catch (err) {
    console.error('카카오 로그인 오류:', err);
    res.status(500).send('카카오 로그인 실패');
  }
});


  // ─────────────────────────────────────────────────────────────
  // 이메일 인증
  // ─────────────────────────────────────────────────────────────
  const emailCodes = {}; // 메모리 저장

  async function saveEmailCode(email, code) {
    emailCodes[email] = code;
    setTimeout(() => delete emailCodes[email], 5 * 60 * 1000); // 5분 후 삭제
  }
  async function checkEmailCode(email, code) {
    return emailCodes[email] === code;
  }

  app.post('/api/send-code', async (req, res) => {
    const { email } = req.body;

    // 이메일 중복 체크
    const existingEmail = await Member.findOne({ email });
    if (existingEmail) return res.status(400).json({ message: '이미 가입된 이메일입니다.' });

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await saveEmailCode(email, code);

    const transporter = nodemailer.createTransport({
      host: 'smtp.naver.com',
      port: 587,
      secure: false,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: '인증번호 발송',
      text: `인증번호: ${code}`,
    });

    res.json({ message: '인증번호 발송 완료' });
  });

  app.post('/api/verify-code', async (req, res) => {
    const { email, code } = req.body;
    try {
      const isValid = await checkEmailCode(email, code);
      if (!isValid) return res.status(400).json({ message: '인증코드가 올바르지 않습니다' });

      const token = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: '5m' });
      res.json({ message: '인증성공', token });
    } catch (error) {
      console.log(error);
      res.status(500).json({ message: 'server error' });
    }
  });

  // ─────────────────────────────────────────────────────────────
  // 회원가입 / 로그인 / 아이디·비번 찾기
  // ─────────────────────────────────────────────────────────────
  app.post('/api/check-userId', async (req, res) => {
    const { userId } = req.body;
    try {
      const existingUser = await Member.findOne({ userId });
      res.json({ exists: !!existingUser });
    } catch (error) {
      res.status(500).json({ message: '서버오류' });
    }
  });

  function randomNickname() {
    const words = ['메갓', '호난사', '마테우스', '보아탱', '크샨테', '알리', '호아킨', '조던', '캐빈', '르브론', '크리링', '야무치', '무천도사', '베지터', '크레용신짱'];
    const w = words[Math.floor(Math.random() * words.length)];
    const n = Math.floor(Math.random() * 100).toString().padStart(2, '0');
    return w + n;
  }

  app.post('/api/register', async (req, res) => {
    const { userId, pwd, nickname, ageRange, name, gender } = req.body;
    try {
      const payload = jwt.verify(req.body.token, process.env.JWT_SECRET);
      const emailByToken = payload.email;

      if (!['male', 'female'].includes(gender)) {
        return res.status(400).json({ message: '성별 값이 올바르지 않습니다.' });
      }

      const existingUserId = await Member.findOne({ userId });
      if (existingUserId) return res.status(400).json({ message: '이미 존재하는 아이디입니다.' });

      const hashedPwd = await bcrypt.hash(pwd, 10);
      const finalNickname = nickname && nickname.trim() ? nickname : randomNickname();

      const newUser = new Member({
        userId,
        pwd: hashedPwd,
        nickname: finalNickname,
        ageRange,
        name,
        gender,
        email: emailByToken,
        enabled: true,
        tempPwd: false,
        
      });

      await newUser.save();
      res.status(201).json({ message: '회원가입 성공' });
    } catch (e) {
      console.error('회원가입 오류', e);
      res.status(400).json({ message: '토큰이 유효하지 않거나 만료되었습니다.' });
    }
  });

  app.post('/api/login', async (req, res) => {
    const { userId, pwd } = req.body;
    try {
      const user = await Member.findOne({ userId });
      if (!user) return res.status(401).json({ message: '아이디 또는 비밀번호가 잘못되었습니다.' });

      const isMatch = await bcrypt.compare(pwd, user.pwd);
      if (!isMatch) return res.status(401).json({ message: '아이디 또는 비밀번호가 잘못되었습니다.' });

      if (user.status === 'suspend') {
        return res.status(403).json({ message: '이용이 정지된 계정입니다.' });
      }

      const token = jwt.sign(
        {
          _id: user._id,
          userId: user.userId,
          nickname: user.nickname,
          role: user.Role || 'user',
        },
        process.env.JWT_SECRET,
        { expiresIn: '2h' }
      );

      res.json({
        message: '로그인 성공',
        token,
        user: {
          _id: user._id,
          userId: user.userId,
          nickname: user.nickname,
          email: user.email,
          role: user.Role || 'user',
        },
      });
    } catch (error) {
      console.error('로그인 오류:', error);
      res.status(500).json({ message: 'server error' });
    }
  });

  app.post('/api/find-id', async (req, res) => {
    const { name, email } = req.body;
    try {
      const user = await Member.findOne({ name, email });
      if (!user) {
        return res.status(404).json({ message: '일치하는 정보가 없습니다.' });
      }
      res.json({ message: `귀하의 아이디는 [${user.userId}] 입니다` });
    } catch (error) {
      console.error('아이디 찾기 오류: ', error);
      res.status(500).json({ message: '서버 에러' });
    }
  });

  function generateTempPassword(length = 8) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    let temp = '';
    for (let i = 0; i < length; i++) temp += chars.charAt(Math.floor(Math.random() * chars.length));
    return temp;
  }

  app.post('/api/find-password', async (req, res) => {
    const { userId, email } = req.body;
    try {
      const user = await Member.findOne({ userId, email });
      if (!user) return res.status(404).json({ message: '아이디 또는 이메일이 일치하지 않습니다.' });

      const tempPassword = generateTempPassword();
      const hashedPwd = await bcrypt.hash(tempPassword, 10);

      user.pwd = hashedPwd;
      user.tempPwd = true;
      await user.save();
      
      const transporter = nodemailer.createTransport({
        host: 'smtp.naver.com',
        port: 587,
        secure: false,
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
      });

      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: user.email,
        subject: ` ${user.name}님에게 임시 비밀번호 발급`,
        text: `귀하의 임시 비밀번호는 [${tempPassword}] 입니다. 로그인 후 반드시 변경해주세요.`,
      });

      res.json({ message: '임시 비밀번호가 이메일로 발송되었습니다.' });
    } catch (error) {
      console.error('비밀번호 찾기 오류:', error);
      res.status(500).json({ message: 'server error' });
    }
  });

// ─────────────────────────────────────────────────────────────
// 내 정보 조회/수정
// ─────────────────────────────────────────────────────────────
  //내정보 조회
  app.get('/api/me', authMiddleware, async (req, res) => {
  try {
    const user = await Member.findOne({ userId: req.userId })
      .select({
        userId: 1,
        nickname: 1,
        ageRange: 1,   // ← 명시
        age: 1,        // ← 과거 숫자 age가 있을 수 있으니 같이
        email: 1,
        name: 1,
        gender: 1,
        backgroundPicture: 1,
        profileImage: 1,
      })
      .lean();        // ← 스키마 영향 최소화

    if (!user) return res.status(404).json({ message: 'cannot find userInfo' });

    const calcAgeRange = (n) => {
      n = Number(n);
      if (!Number.isFinite(n)) return '';
      if (n < 10) return '10대 미만';
      if (n >= 80) return '80대 이상';
      return `${Math.floor(n / 10) * 10}대`;
    };

    const base = process.env.BASE_URL || 'http://localhost:8080';
    const ageRangeOut = user.ageRange && user.ageRange.trim()
      ? user.ageRange
      : calcAgeRange(user.age);

    res.json({
      userId: user.userId,
      nickname: user.nickname,
      ageRange: ageRangeOut, // ✅ 이제 항상 채워서 내려감
      email: user.email || '',
      name: user.name || '',
      gender: (user.gender === 'male' || user.gender === 'female') ? user.gender :'male',
      backgroundPicture: user.backgroundPicture ? `${base}${user.backgroundPicture}` : '',
      profileImage: user.profileImage ? `${base}${user.profileImage}` : '',
    });
  } catch (error) {
    console.log('유저 정보 조회 에러', error);
    res.status(500).json({ message: 'server error' });
  }
});

  //내정보 수정
app.put('/api/change-info', authMiddleware, async (req, res) => {
  try {
    console.log('[member gender enum at runtime] =', Member.schema.path('gender').options.enum);
    console.log('[change-info] userId:', req.userId);
    console.log('[change-info] headers.content-type:', req.headers['content-type']);
    console.log('[change-info] raw body typeof:', typeof req.body, 'value:', req.body);
    console.log('[change-info] userId:', req.userId);
    console.log('[change-info] enum(gender)=', require('../models/memberSchema').schema.path('gender').enumValues);
    console.log('[change-info] body=', req.body);

    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const { nickname, ageRange, email, name, gender } = body;

    const updates = {};
    if (typeof nickname === 'string' && nickname.trim()) updates.nickname = nickname.trim();
    if (typeof ageRange === 'string') updates.ageRange = ageRange.trim();
    if (typeof email === 'string' && email.trim()) updates.email = email.trim().toLowerCase();
    if (typeof name === 'string' && name.trim()) updates.name = name.trim();
    if (typeof gender === 'string' && ['male','female'].includes(gender)) updates.gender = gender;

    if (Object.keys(updates).length === 0)
      return res.status(400).json({ message: '변경할 값이 없습니다.' });

    const doc = await Member.findOne({ userId: req.userId });
    if (!doc) return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });

    Object.assign(doc, updates);
    await doc.save();

    res.json({ message: '개인정보가 수정되었습니다.' });
  } catch (error) {
    console.error('개인정보 수정 오류:', {
      name: error.name,
      message: error.message,
      errors: error.errors,
      stack: error.stack,
    });
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: '입력 형식 오류', detail: error.message });
    }
    res.status(500).json({ message: 'server error' });
  }
});



  app.put('/api/change-password', authMiddleware, async (req, res) => {
    const { currentPwd, newPwd } = req.body;
    try {
      const user = await Member.findOne({ userId: req.userId });
      if (!user) return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });

      // 소셜 로그인(비번 없음) 예외 처리
      if (!user.pwd) {
        return res.status(400).json({ message: '소셜 로그인 계정은 비밀번호 변경이 불가합니다.' });
      }

      const isMatch = await bcrypt.compare(currentPwd || '', user.pwd);
      if (!isMatch) return res.status(400).json({ message: '현재 비밀번호가 일치하지 않습니다.' });

      const hashedNewPwd = await bcrypt.hash(newPwd, 10);
      user.pwd = hashedNewPwd;
      user.tempPwd = false;
      await user.save();

      res.json({ message: '비밀번호가 성공적으로 변경되었습니다.' });
    } catch (error) {
      console.error('비밀번호 변경 오류:', error);
      res.status(500).json({ message: '서버 오류가 발생했습니다.' });
    }
  });

  // ─────────────────────────────────────────────────────────────
  // 정적 파일/업로드
  // ─────────────────────────────────────────────────────────────
  app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
  const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const safeName = file.originalname.replace(/[^\w.\-]+/g, '_');
      cb(null, uniqueSuffix + '-' + safeName);
    },
  });
  const upload = multer({ storage });

  app.post('/api/me/upload-background', authMiddleware, upload.single('backgroundPicture'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: '파일이 없습니다.' });
      const userId = req.userId;
      const filePath = `/uploads/${req.file.filename}`;

      const member = await Member.findOne({ userId });
      if (!member) return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });

      if (member.backgroundPicture) {
        const relativePath = member.backgroundPicture.startsWith('/') ? member.backgroundPicture.slice(1) : member.backgroundPicture;
        const oldImagePath = path.join(__dirname, '..', relativePath);
        if (fs.existsSync(oldImagePath)) {
          try { fs.unlinkSync(oldImagePath); } catch (e) { console.error('기존 이미지 삭제 실패', e); }
        }
      }

      member.backgroundPicture = filePath;
      await member.save();

      const base = process.env.BASE_URL || 'http://localhost:8080';
      res.json({ backgroundPicture: `${base}${filePath}` });
    } catch (err) {
      console.error('이미지 업로드 오류:', err);
      res.status(500).json({ message: '업로드 실패' });
    }
  });

  app.post('/api/me/upload-profileImage', authMiddleware, upload.single('profileImage'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: '파일이 없습니다.' });
      const userId = req.userId;
      const filePath = `/uploads/${req.file.filename}`;

      const member = await Member.findOne({ userId });
      if (!member) return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });

      if (member.profileImage) {
        const relativePath = member.profileImage.startsWith('/') ? member.profileImage.slice(1) : member.profileImage;
        const oldImagePath = path.join(__dirname, '..', relativePath);
        if (fs.existsSync(oldImagePath)) {
          try { fs.unlinkSync(oldImagePath); } catch (e) { console.error('기존 프로필이미지 삭제 실패', e); }
        }
      }

      member.profileImage = filePath;
      await member.save();

      const base = process.env.BASE_URL || 'http://localhost:8080';
      res.json({ profileImage: `${base}${filePath}` });
    } catch (err) {
      console.error('프로필 이미지 업로드 오류:', err);
      res.status(500).json({ message: '프로필 이미지 업로드 실패' });
    }
  });

  // ─────────────────────────────────────────────────────────────
  // 멤버 상태/프로필 공개 조회
  // ─────────────────────────────────────────────────────────────
  app.get('/api/member/status', async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).json({ message: '토큰이 없습니다.' });

      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      const member = await Member.findById(decoded._id).select('status nickname');
      if (!member) return res.status(404).json({ message: '회원 정보를 찾을 수 없습니다.' });

      res.json({ status: member.status, nickname: member.nickname });
    } catch (err) {
      console.error('status 조회 실패:', err);
      res.status(500).json({ message: '서버 오류' });
    }
  });

  // ✅ 게시글 작성자(다른 사람)의 정보 조회용 (토큰 불필요) — ✨닫힘 누락 수정
  app.get('/api/member/by-id/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      const member = await Member.findOne({ userId }).select('nickname ageRange gender');
      if (!member) return res.status(404).json({ message: '회원 정보를 찾을 수 없습니다.' });
      res.json(member);
    } catch (err) {
      console.error('회원 정보 조회 오류:', err);
      res.status(500).json({ message: 'server error' });
    }
  });

  // ─────────────────────────────────────────────────────────────
  // 회원 탈퇴 + 연관 데이터 정리
  // ─────────────────────────────────────────────────────────────
  app.post('/api/delete-account', authMiddleware, async (req, res) => {
    try {
      console.log('aaa');
      
      const { currentPwd, confirm } = req.body;

      if (confirm !== '회원탈퇴') {
        return res.status(400).json({ message: '확인 문구가 올바르지 않습니다. (회원탈퇴 입력 필요)' });
      }

      const user = await Member.findOne({ userId: req.userId });
      if (!user) return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });

      // (선택) 관리자 보호
      // if ((user.Role || user.role) === 'admin') {
      //   return res.status(403).json({ message: '관리자 계정은 탈퇴할 수 없습니다.' });
      // }

      // 소셜 계정(비번 없음)은 비번 검증 생략
      const isSocial = !!user.oauthProvider && (!user.pwd || user.pwd === '');
      if (!isSocial) {
        const ok = await bcrypt.compare(currentPwd || '', user.pwd);
        if (!ok) return res.status(400).json({ message: '현재 비밀번호가 일치하지 않습니다.' });
      }

      const userId = user.userId;

      // 1) 사용자가 작성한 게시글들 조회 (numBrd 수집)
      const myBoards = await Board.find({ userId }).lean();
      const myBoardNums = myBoards.map((b) => b.numBrd);

      // 2) 게시글 이미지 파일 삭제
      const boardImages = await Image.find({ numBrd: { $in: myBoardNums } }).lean();
      for (const doc of boardImages) {
        for (const img of doc.images || []) {
          const p = img.path;
          if (!p) continue;
          try {
            const rel = p.startsWith('/') ? p.slice(1) : p;
            const abs = path.join(__dirname, '..', rel);
            if (fs.existsSync(abs)) fs.unlinkSync(abs);
          } catch (e) {
            console.error('게시글 이미지 파일 삭제 실패:', e);
          }
        }
      }

      // 3) 사용자가 누른 "게시글 좋아요" 정리
      const myGoodDoc = await Good.findOne({ userID: userId }).lean(); // 스키마가 userID 필드라고 가정
      if (myGoodDoc && Array.isArray(myGoodDoc.numBrd) && myGoodDoc.numBrd.length) {
        await Board.updateMany(
          { numBrd: { $in: myGoodDoc.numBrd } },
          { $inc: { good: -1 } }
        );
        await Good.deleteOne({ userID: userId });
      }

      // 4) 내 게시글 삭제로 인해 타인의 Good/Share 문서에서 해당 게시글 번호 제거
      if (myBoardNums.length) {
        await Good.updateMany(
          { numBrd: { $in: myBoardNums } },
          { $pull: { numBrd: { $in: myBoardNums } } }
        );
      }

      // 5) 댓글 삭제 (내가 쓴 댓글 + 내 게시글에 달린 댓글)
      await Review.deleteMany({ userId });
      if (myBoardNums.length) {
        await Review.deleteMany({ numBrd: { $in: myBoardNums } });
      }

      // 6) 여행지 좋아요/북마크 제거
      await TripGood.deleteMany({ userid: userId });
      await TripBookmark.deleteMany({ userid: userId });

      // 8) 게시글/이미지 문서 삭제
      if (myBoardNums.length) {
        await Image.deleteMany({ numBrd: { $in: myBoardNums } });
        await Board.deleteMany({ userId });
      }

      // 9) 프로필/배경 이미지 파일 삭제
      const removeIfExists = (p) => {
        if (!p) return;
        try {
          const rel = p.startsWith('/') ? p.slice(1) : p;
          const abs = path.join(__dirname, '..', rel);
          if (fs.existsSync(abs)) fs.unlinkSync(abs);
        } catch (e) {
          console.error('프로필/배경 이미지 삭제 실패:', e);
        }
      };
      removeIfExists(user.backgroundPicture);
      removeIfExists(user.profileImage);

      // 10) 최종적으로 회원 삭제
      await Member.deleteOne({ _id: user._id });

      res.json({ message: '회원 탈퇴가 완료되었습니다.' });
    } catch (err) {
      console.error('회원 탈퇴 오류:', err);
      res.status(500).json({ message: 'server error' });
    }
  });
};

// 미들웨어를 별도로도 사용할 수 있게 export
module.exports.authMiddleware = authMiddleware;
