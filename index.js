require('dotenv').config();
const express = require('express');
const cors = require('cors');
const PORT = process.env.PORT || 8080;
const mongoose = require('mongoose')
const jwt = require('jsonwebtoken');
const router = express.Router();
mongoose.set('strictQuery',false)

const tripGoodRouter = require("./routers/tripGoodRouter")
const tripBookmarkRouter = require("./routers/tripBookmarkRouter")
const myInfoDataRouter = require("./routers/myInfoDataRouter")

require('./models/reviewSchema');
require('./models/boardSchema');
//require('./models/imageSchema');
//require('./models/goodSchema');
//require('./models/shareSchema');

const path = require('path');
const app = express();

const axios = require('axios');

require('./models/memberSchema')

app.use(express.json())
app.use(express.urlencoded({ extended: true }));

const {addBoardRouter,getBoardRouter,getImageRouter,getOneBoardData,reportBoard,deleteBoard,hitBoard,updateBoardRouter,goodToggleRouter,getRandomImageRouter} = require('./routers/boardRouter')
addBoardRouter(app,router)
getBoardRouter(app)
getImageRouter(app)
getOneBoardData(app)
reportBoard(app)
deleteBoard(app)
hitBoard(app)
updateBoardRouter(app)
goodToggleRouter(app)
getRandomImageRouter(app)

//미들웨어
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

app.get('/api/ping', (req, res) => {
  res.status(200).json({ ok: true, t: Date.now() })
})

app.use('/api/tour', require('./routers/tourRouter'));

require('./routers/reviewRouters')(router)
app.use(router)

require('./models/adEventSchema');
app.use('/api/ad', require('./routers/eventAdRouter'));

const adminRouter = require('./routers/adminRouter')
app.use('/api/admin', adminRouter);

app.use('/uploads',express.static(path.join(__dirname,'uploads')))

require('./routers/auth')(app);

app.use("/api/tripGoods",tripGoodRouter)
app.use("/api/tripBookmark",tripBookmarkRouter)
app.use("/api/myInfoData",myInfoDataRouter)


const courseRouter = require('./routers/courseRouter');
app.use('/api/course', courseRouter);

//Express 서버 시작
try{
    const start = async() => {
      const MONGO_URI = process.env.MONGO_URI;
      const DB_NAME = process.env.MONGO_DB_NAME;

      await mongoose.connect(MONGO_URI, { dbName: DB_NAME })
      .then(()=>{
        console.log('MongoDB 연결 성공');
      }).catch((err) => {
        console.log('MongoDB 연결 실패:', err.message);
      });
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`서버 실행 포트: ${PORT}`);
      });
    }
    console.log('BASE_URL from env:', process.env.BASE_URL);
    const os = require('os');
    const networkInterfaces = os.networkInterfaces();
    console.log('서버가 실행된 장비의 IP 목록:', networkInterfaces);
    start()
}catch(e){
    console.error('DB연결 실패!')
    process.exit(1)
}

// React 빌드 폴더 제공 (배포시 사용)
//app.use(express.static(path.join(__dirname, 'client/build')));

//app.get('/', (req, res) => {
//  res.sendFile(path.join(__dirname, 'client/build/index.html'));
//});




