const mongoose = require('mongoose')
const fs = require('fs')
const multer = require('multer')
const path = require('path')
const Board = mongoose.model('board')
const Image = mongoose.model('image')
const Good = mongoose.model('good')
const Review = mongoose.model('reviewdbs')
const express = require('express');
const { checkPenalty } = require('../middlewares/checkPenalty')
const { ALLOWED_TOUR_STYLES } = require('../models/boardSchema')
const { authMiddleware } = require('./auth')
require('dotenv').config()
const BASE_URL=process.env.BASE_URL;
const PIXABAY_KEY = '52803438-608e953f44dc0a77c56d1c912'
const axios = require('axios')
const router = express.Router();

function sanitizeTourStyle(input) {
  if (!Array.isArray(input)) return [];
  const ALLOWED_TOUR_STYLES = [
    '맛집탐방','카페투어','사진/인스타','힐링/산책','온천·스파','호캉스',
    '문화·역사','전시·공연·축제','쇼핑','야경감상','드라이브','등산·트레킹',
    '바다·서핑','캠핑·글램핑','액티브·레저','아이와 함께','반려동물 동반','당일치기'
  ];
  return input.filter(s => ALLOWED_TOUR_STYLES.includes(s));
}

// uploads 폴더 확인
try {
    fs.readdirSync('uploads');
} catch (error) {
    fs.mkdirSync('uploads');
}

const storage = multer.diskStorage({
    destination:(req,fileUpload,callback) => {
        callback(null,'uploads')
    },
    filename:(req,fileUpload,callback) => {
        callback(null,Date.now().toString() + path.extname(fileUpload.originalname))
    }
})

const uploads = multer({
    storage:storage,
    limits:{
        files:10,
        fileSize:100*1024*1024
    }
})

const addBoardRouter = (app,router) => {
    
    const ALLOWED = new Set(ALLOWED_TOUR_STYLES)

    const sanitizeTourStyle = (input) => {
        const arr = Array.isArray(input) ? input : []
        const clean = Array.from(new Set(
            arr.map(String).map(s => s.trim()).filter(s => ALLOWED.has(s))
        ))
        return clean.slice(0,5)
    }

    router.route('/api/board').post(checkPenalty,uploads.array('upload',10),async (req,res) => {
       
        const safeParse = (s) => {
            if (!s || s === 'undefined' || s === 'null') return null;
            try { return JSON.parse(s); } catch { return null; }
        };
        
        const body = safeParse(req.body.board) || {};
        let  spot = safeParse(req.body.spot);            // 보냈으면 우선 사용

        if (typeof body.pinTop === "boolean") {
            body.pinTop = body.pinTop;   // 그대로 유지
        } else {
            body.pinTop = false;         // 기본값
        }

        const defaultImageUrl = req.body.defaultImageUrl;

        // 2) spot이 없으면 board.tourSpot로 폴백
        if (!spot && body.tourSpot && typeof body.tourSpot === 'object') {
            const { lat, lng, address = '', roadAddress = '', borough = '', placeName = '' } = body.tourSpot || {};
            spot = { lat, lng, address, roadAddress, borough, placeName };
        }

        const latest = await Board.findOne().sort({numBrd:-1}).lean();
        const newNum = latest ? latest.numBrd + 1 : 1;
        const files = Array.isArray(req.files) ? req.files : []
        
        const tourStyle = sanitizeTourStyle(body.tourStyle)

        const hasValidLatLng =
            spot &&
            Number.isFinite(Number(spot.lat)) &&
            Number.isFinite(Number(spot.lng));

        
        const payload = { ...body, numBrd:newNum, tourStyle };

        if(hasValidLatLng){
        payload.tourSpot = {
                address:spot.address || '',
                roadAddress:spot.roadAddress || '',
                placeName:spot.placeName || '',
                borough:spot.borough || '',
                location:{type:'Point',coordinates:[Number(spot.lng),Number(spot.lat)]}
            }
        }
        const board = await Board.create(payload)

        const images =  files.map(file => ({
            originalFileName:file.originalname,
            saveFileName:file.filename,
            path:`${BASE_URL}/uploads/${file.filename}`
        }))

        if(images.length){
            await Image.create({numBrd:board.numBrd,images,})      
        }else if(defaultImageUrl){
            await Image.create({numBrd:board.numBrd,images:[{
                originalFileName:'pixabay',
                saveFileName:'pixabay',
                path:defaultImageUrl
            }]})
        }

        return res.status(200).send()
    })
}

// 게시글 신고
const reportBoard = (app) => {
    app.put('/api/board/report/:numBrd', async (req, res) => {
        try{
            console.log('신고 요청 들어옴:', req.params.numBrd);
            const {numBrd} = req.params

            const board = await Board.findOne({ numBrd: Number(numBrd) })
            if(!board) {
                return res.status(404).json({message: '게시글을 찾을 수 없습니다.'})
            }
            board.report = true
            await board.save()

            return res.status(200).json({message: '게시글 신고가 접수되었습니다.', report: true })
        }catch (err){
            console.error('게시글 신고 처리 오류:', err)
            return res.status(500).json({ message: '서버 오류로 게시글 신고 처리에 실패했습니다.' })
        }
    })
}

const getBoardRouter = (app) => {
    app.get('/api/board', async (req, res, next) => {
        try {
            const base = process.env.BASE_URL;
            // 페이징/기본값
            let skip = Number(req.query.skip);
            let limit = Number(req.query.limit);
            if (Number.isNaN(skip)) skip = 0;
            if (Number.isNaN(limit)) limit = 10;

            // 공통 파라미터
            const {
                cat = req.query.cat || 'mate',
                keyword = req.query.keyword?.trim(),
                searchKey = req.query.searchKey || 'subject',
                sort = req.query.sort || 'desc', // 'asc' | 'desc'
                include = req.query.include || 'cover', // 'all' | 'cover'
                topic = req.query.topic || null,
            } = req.query;

            // 유틸
            const toArray = (v) => (!v ? [] : Array.isArray(v) ? v : [v]);

            

            // -------------------- 분리된 필터 쿼리 --------------------
            // ① 작성자(author.*)
            const authorGender = (req.query.authorGender || '').trim() || null;
            const authorAges = toArray(req.query.authorAge)
            .map((n) => parseInt(n, 10))
            .filter((n) => !Number.isNaN(n)); // [20,30,...]

            // ② 여행일정(when.*)
            const startDate = req.query.startDate || null;
            const endDate = req.query.endDate || null;

            // ③ 동행조건(cond.*) — 글의 mateCondition.* 과 매칭
            const condGender = (req.query.condGender || '').trim() || null;
            const condAges = toArray(req.query.condAge).map(String); // 스키마상 String[]과 비교
            const condTypes = toArray(req.query.condType);

            // -------------------- 글 자체 매치 --------------------
            const match = {$and: []};

            // 숨김 제외 (hidden: false or not exists)
            match.$and.push ({$or : [{ hidden: { $exists: false } }, { hidden: false }] });

            // 카테고리
            if (cat) {
                if (cat === 'mate') match.$and.push({ boardType: 'mate' });
                else match.$and.push({ boardType: { $ne: 'mate' } });
            }

            // 포스트 topic
            if (topic && cat !== 'mate')  match.$and.push({ topic });

            // 키워드
            if (keyword && keyword.trim()) {
                match.$and.push({
                    $or: [
                        { subject: { $regex: keyword, $options: 'i' } },
                        { content: { $regex: keyword, $options: 'i' } },
                    ]
                })
            }

            // (A) 동행조건: 글의 mateCondition.*
            if (condTypes.length > 0) match.$and.push({ 'mateCondition.type': { $in: condTypes } });
            if (condGender) match.$and.push({ 'mateCondition.gender': condGender });
            if (condAges.length > 0) match.$and.push({ 'mateCondition.age': { $in: condAges } });

            // (B) 여행일정 overlap
            if (startDate && endDate) {
                const s = new Date(startDate);
                const e = new Date(endDate);
                match.$and.push ({
                    $or: [
                        {
                            $and: [
                                { startDate: { $ne: null } },
                                { endDate: { $ne: null } },
                                { startDate: { $lte: e } },
                                { endDate: { $gte: s } },
                            ],
                        },
                        {
                            $and: [
                                { startDate: { $ne: null } },
                                { endDate: { $eq: null } },
                                { startDate: { $gte: s, $lte: e } },
                            ],
                        },
                    ],
                });
            }

            if (match.$and.length === 0) delete match.$and

            // -------------------- 작성자 조인 & 필터 --------------------
            const applyAuthorFilter = (authorGender && authorGender.trim()) || authorAges.length > 0;

            const authorPipeline = [
                { $addFields: { userIdStr: { $toString: '$userId' } } },
                { $match: { $expr: { $eq: ['$userIdStr', '$$uid'] } } },
                ...(authorGender ? [{ $match: { gender: authorGender } }] : []),
                ...(authorAges.length>0 ? [
                    { $addFields: { _ageRaw: { $ifNull: ['$age','$ageRange']}}},
                    { $addFields: { _ageStr: { $toString: '$_ageRaw' } } },
                    { $addFields: { _age2Digits: { $regexFind: { input: '$_ageStr', regex: /(\d{2})/ } } } },
                    { $addFields: { ageNum: { $cond: [ { $ne: ['$_age2Digits', null ] }, { $toInt: '$_age2Digits.match' }, null ] } } },
                    {$match: {ageNum: {$ne: null}}},
                    {$addFields: {ageDecade: {$multiply: [{$floor: {$divide: ['$ageNum', 10]}},10]}}},
                    {$match: {ageDecade: {$in: authorAges}}}
                ] : []),
                {
                    $project: {
                        _id: 0,
                        userId: 1,
                        nickname: 1,
                        age: 1,
                        ageRange: 1,
                        gender: 1,
                        profileImage: '$backgroundPicture',
                    },
                },
            ];

            let sortField = {};

            switch(sort) {
                case 'asc':
                    sortField = {pinTop: -1, _id:1};
                    break;
                
                case 'desc':
                    sortField = {pinTop: -1, created:-1, _id:-1};
                    break;
                
                case 'view':
                    sortField = {pinTop: -1, hitCount:-1, _id:-1}
                    break;

                case 'good':
                    sortField = {pinTop:-1, good:-1, _id:-1}
                    break;

                default:
                    sortField = {pinTop:-1, _id:-1}
            }

            const sortOption = [{$sort:sortField}];

            const lookupCover = {
                $lookup: {
                    from: 'images',
                    localField: 'numBrd',
                    foreignField: 'numBrd',
                    as: 'imgdoc',
                    pipeline: [{ $project: { _id: 0, numBrd: 1, images: { $arrayElemAt: ['$images', 0] } } }],
                },
            };

            const lookupAll = {
                $lookup: {
                    from: 'images',
                    localField: 'numBrd',
                    foreignField: 'numBrd',
                    as: 'imgdoc',
                    pipeline: [{ $project: { _id: 0, numBrd: 1, images: 1 } }],
                },
            };


            const lookupAuthor = {
                $lookup: {
                    from: 'members',
                    let: { uid: '$userId' },
                    pipeline: authorPipeline,
                    as: 'authorDoc',
                },
            };


            const requireAuthorMatch = applyAuthorFilter ? { $match: { authorDoc: { $ne: [] } } } : null;

            const addAuthorField = {
                $addFields: {
                    author: {
                        $let: {
                            vars: { doc: { $arrayElemAt: ['$authorDoc', 0] } },
                            in: {
                                userId: '$$doc.userId',
                                nickname: '$$doc.nickname',
                                age: '$$doc.age',
                                gender: '$$doc.gender',
                                profileImage: {
                                    $cond: [
                                        { $and: [{ $ne: ['$$doc.profileImage', null] }, { $ne: ['$$doc.profileImage', ''] }] },
                                        { $concat: [base, '$$doc.profileImage'] },
                                        '',
                                    ],
                                },
                            },
                        },
                    },
                },
            };

            const addImageField =
            include === 'all'
            ? { $addFields: { images: { $ifNull: [{ $arrayElemAt: ['$imgdoc.images', 0] }, []] } } }
            : { $addFields: { coverImage: { $ifNull: [{ $arrayElemAt: ['$imgdoc.images', 0] }, null] } } };

            const projectStage = { $project: { imgdoc: 0, authorDoc: 0 } };

            const pipeline = [
                { $match: match },
                ...sortOption,
                lookupAuthor,
                ...(requireAuthorMatch ? [requireAuthorMatch] : []),
                { $skip: skip },
                { $limit: limit },
                addAuthorField,
                include === 'all' ? lookupAll : lookupCover,
                addImageField,
                projectStage,
            ];

            const boards = await Board.aggregate(pipeline);
            return res.status(200).send(boards);
        } catch (err) {
            next(err);
        }
    });
};

const getImageRouter = (app) => {
    app.get('/api/images',async(req,res) => {
        
        const numBrd = req.query.numBrd

        const images = await Image.findOne({numBrd:numBrd})

        return res.status(200).send(images)
    })
}

const getOneBoardData = (app) => {
    app.get('/api/oneboard',async(req,res) => {
        const numBrd = req.query.numBrd
        console.log(numBrd)

        const oneBoard = await Board.findOne({numBrd:numBrd})

        return res.status(200).send(oneBoard)
    })
}

// 게시글 삭제
const deleteBoard = (app) => {
    app.delete('/api/board/:numBrd', async (req, res) => {
        try{
            const {numBrd} = req.params
            const {userId} = req.body

            const board = await Board.findOne({ numBrd: Number(numBrd) })
            
            if (!board) {
                return res.status(404).json({ message: '게시글을 찾을 수 없습니다.' })
            }
            
            if (userId && board.userId !== userId) {
                return res.status(403).json({ message: '삭제 권한이 없습니다.' })
            }

            // 실제 이미지 파일 찾기
            const imageDel = await Image.findOne({ numBrd: Number(numBrd) })

            // 실제 삭제
            if (imageDel && Array.isArray(imageDel.images)) {
                for (const img of imageDel.images) {
                    const filePath = path.join('uploads', img.saveFileName);
                    try {
                        if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath); 
                        console.log('삭제된 파일:', filePath);
                        }
                    } catch (err) {
                        console.warn('파일 삭제 실패:', filePath, err.message);
                    }
                }
            }

            // 관련 데이터 삭제 (게시글 + 이미지 + 댓글 + 좋아요 + 공유)
            await Promise.all([
                Board.deleteOne({ numBrd: Number(numBrd) }),
                Image.deleteOne({ numBrd: Number(numBrd) }),
                Review.deleteMany({ numBrd: Number(numBrd) }),
                Good.updateMany({}, { $pull: { numBrd: Number(numBrd) } }),
            ])
            return res.status(200).json({ message: '게시글이 삭제되었습니다.' })

        }catch(err){
            console.error('게시글 삭제 오류:', err)
            return res.status(500).json({ message: '서버 오류로 게시글 삭제 실패' })
        }
    })
}

// 조회수
const hitBoard = (app) => {
    app.put('/api/board/hit/:numBrd', async (req, res) => {
        try{
            const {numBrd} = req.params

            const board = await Board.findOneAndUpdate(
                { numBrd: Number(numBrd) },
                { $inc: { hitCount: 1 } },
                { new: true }
            )

            if(!board){
                return res.status(404).json({ message: '게시글을 찾을 수 없습니다.' })
            }
             return res.status(200).json({message: '조회수 증가 성공', hitCount: board.hitCount})
        }catch (err) {
            console.log('조회수 증가 오류:',err)
            return res.status(500).json({message: '서버 오류로 조회수 증가 실패'})
        }
    })
}


const updateBoardRouter = (app) => {
    app.put('/api/board/edit/:numBrd',uploads.array('upload',10),async(req,res) => {
        const numBrd = Number(req.params.numBrd)
        const safeParse = s => {if(!s || s==='undefined'||s==='null') return null;try { return JSON.parse(s); } catch { return null; } };

        const body = safeParse(req.body.board) || {};
        const imagesToDelete = safeParse(req.body.imagesToDelete) || [];

        // tourStyle 정제는 기존 sanitizeTourStyle 재사용
        const tourStyle = sanitizeTourStyle(body.tourStyle);

        // 1) 본문/기본 필드 업데이트
        const b = await Board.findOneAndUpdate(
            { numBrd },
            {
            $set: {
                subject: body.subject,
                content: body.content,
                tags: body.tags || [],
                boardType: body.boardType || 'mate',
                tourStyle,
                startDate: body.startDate ? new Date(body.startDate) : null,
                endDate: body.endDate ? new Date(body.endDate) : null,
                tourSpot: body.tourSpot ? {
                    address: body.tourSpot.address || '',
                    roadAddress: body.tourSpot.roadAddress || '',
                    placeName: body.tourSpot.placeName || '',
                    borough: body.tourSpot.borough || '',
                    location: {
                        type: 'Point',
                        coordinates: [ Number(body.tourSpot?.location?.coordinates?.[0] ?? body.tourSpot?.lng),
                                    Number(body.tourSpot?.location?.coordinates?.[1] ?? body.tourSpot?.lat) ]
                    }
                } : undefined
            }
            },
            { new: true }
        );

        if (!b) return res.status(404).json({ message: '게시글이 없습니다.' });

        // 2) 이미지 문서 처리
        const files = Array.isArray(req.files) ? req.files : [];
        const newImgs = files.map(f => ({
            originalFileName: f.originalname,
            saveFileName: f.filename,
            path: `${BASE_URL}/uploads/${f.filename}`
        }));

        const imgDoc = await Image.findOne({ numBrd });
        if (!imgDoc) {
            if (newImgs.length) {
            await Image.create({ numBrd, images: newImgs });
            }
        } else {
            // 삭제 표시된 것 제거
            if (imagesToDelete.length) {
            imgDoc.images = imgDoc.images.filter(img =>
                !imagesToDelete.includes(img._id?.toString()) &&
                !imagesToDelete.includes(img.saveFileName) &&
                !imagesToDelete.includes(img.path)
            );
            }
            // 새 파일 추가
            if (newImgs.length) imgDoc.images.push(...newImgs);
            await imgDoc.save();
        }

        return res.status(200).send();
    })
}
const goodToggleRouter = (app) => {
    app.post('/api/board/good/:numBrd',authMiddleware, async (req, res) => {
      try{
        const { numBrd } = req.params;
        const userId = req.userId;
        console.log('좋아요 요청:', { numBrd, userId });
        const add = await Good.updateOne(
            { userId },
            { $addToSet: { numBrd: Number(numBrd) } },
            { upsert: true }
        )
        let liked;
        if (add.modifiedCount > 0 || add.upsertedCount > 0) {
            liked = true;
            await Board.updateOne(
                { numBrd: Number(numBrd) },
                { $inc: { good: 1 } }
            );
        }else{
            liked = false;
            const pull = await Good.updateOne(
                { userId },
                { $pull: { numBrd: Number(numBrd) } }
            );
            if (pull.modifiedCount > 0) {
                await Board.updateOne(
                    { numBrd: Number(numBrd) },
                    { $inc: { good: -1 } }
                );
            }
        }

        const b = await Board.findOne({ numBrd: Number(numBrd) },{ good: 1, _id: 0 }).lean();
        return res.status(200).json({ liked, goodCount: b?.good?? 0 });
      } catch{
        return res.status(500).json({ message: '서버 오류로 좋아요 처리 실패' });
      } 
    })

    app.get('/api/board/good/:numBrd',authMiddleware, async (req, res) => {
      try{
        const { numBrd } = req.params;
        const userId = req.userId;

        const g = await Good.findOne({ userId, numBrd: Number(numBrd) }).lean();
        const liked = Array.isArray(g?.numBrd) && g.numBrd.includes(Number(numBrd));
        const b = await Board.findOne({ numBrd: Number(numBrd) },{ good: 1, _id: 0 }).lean();
        return res.status(200).json({ liked, goodCount: b?.good ?? 0 });
      }catch{
        return res.status(500).json({ message: '서버 오류로 좋아요 상태 조회 실패' });
      }
    })

    app.get('/api/board/goodForUser', async (req, res) => {
        try{
            const userId = req.query.userId;
            const g = await Good.findOne({userId}).lean();
            const likedNums = Array.isArray(g?.numBrd) ? g.numBrd : [];
           
            if (likedNums.length === 0) {
                return res.status(200).json({ likedBoards: [] });
            }

            const likedBoards = await Board.find(
                { numBrd: {$in: likedNums} }).lean();
            return res.status(200).json({ likedBoards });
        }catch{
            return res.status(500).json({ message: '서버 오류로 좋아요 상태 조회 실패' });
        }
    })
}
const getRandomImageRouter = (app) => {
     app.get('/api/randomImage', async (req, res) => {
        try {
            const {data} = await axios.get('https://pixabay.com/api/', {
                params: {
                    key: PIXABAY_KEY,
                    q: 'seoul',
                    image_type: 'photo',
                    orientation: 'horizontal',
                    safesearch: true,
                    per_page: 50
                }
            })

            if(!data.hits || data.hits.length === 0) {
                return res.status(404).json({message: 'No images found'})
            }

            const randomImage = data.hits[Math.floor(Math.random() * data.hits.length)]

            return res.status(200).json({
                url: randomImage.largeImageURL,
                tags: randomImage.tags,
                user: randomImage.user
            })

        } catch (error) {
            console.error('Error fetching random images:', error)
            return res.status(500).json({message: 'Error fetching random images'})
        }
    })
}
module.exports = {addBoardRouter,getBoardRouter,getImageRouter,getOneBoardData,reportBoard,deleteBoard,hitBoard,updateBoardRouter,goodToggleRouter,getRandomImageRouter}
