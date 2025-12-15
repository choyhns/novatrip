# novatrip

## 프로젝트 소개

NovaTrip은 여행 정보 공유와 커뮤니티 기능을 결합한 서울 기반 여행 플랫폼입니다.
사용자는 여행지를 탐색하고, 게시글을 작성하며, 좋아요·댓글·북마크 등을 통해
다른 사용자와 여행 경험을 공유할 수 있습니다.

본 프로젝트는 팀 프로젝트로 진행되었으며,
저는 DB 설계와 커뮤니티 핵심 기능 구현을 중심으로 프로젝트의 구조적 안정성을 담당했습니다.

## 기술 스택

- Frontend
  - React
  - JavaScript
  - TailwindCss

- Backend
  - Node.js
  - Express
  - JWT 기반 인증

- Database
  - MongoDB
  - Mongoose
 
- Tool/Infra
  - Git / GitHub
  - REST API


## 프로젝트 구성
- 프로젝트 유형: 팀 프로젝트
- 인원: 4명
- 개발 기간: 14일

## 담당 역할
### DB설계 및 데이터 구조 정립
- MongoDB 기반 컬렉션 구조 설계
- Board/Review/Image/Good 등 커뮤니티 도메인 중심 스키마 설계

### 커뮤니티 게시판 기능 구현
- 게시글 작성/수정/삭제 기능 구현
- 다중 이미지 업로드 처리

### 코드 병합 및 충돌 관리
- 팀원 간 브랜치 병합 시 충돌 해결
- 라우터 / 모델 / 미들웨어 구조를 정리하여 중복 코드 제거

## .env.example
실제 .env 파일은 Git에 포함하지 않고 .env.example만 관리하여
보안 및 환경 분리를 유지했습니다.

- Server
  - PORT=8080
  - BASE_URL=http://localhost:8080
- MongoDB
  - MONGO_URI=http://localhost:27017
  - MONGO_DB_NAME=NovaTrip
- Auth
  - JWT_SECRET=YOUR_JWT_SECRET
- Email
  - EMAIL_USER=YOUR_EMAIL
  - EMAIL_PASS=YOUR_EMAIL_PASSWORD
- Kakao OAuth
  - KAKAO_REST_API_KEY=YOUR_KAKAO_REST_API_KEY
  - KAKAO_REDIRECT_URI=http://localhost:8080/login/auth/kakao/callback
- Frontend
  - FRONTEND_URL=http://localhost:3000
- Tour API
  - TOUR_API_SERVICE_KEY=YOUR_TOUR_API_KEY
  - TOUR_API_BASE=http://apis.data.go.kr/B551011/KorService2

## 실행 방법
### 환경
- Node.js 18+
- MongoDB

### 설치 및 실행
- npm install
- npm start

### 환경 변수 설정
- PORT=8080
- MONGO_URI=mongodb://localhost:27017
- MONGO_DB_NAME=NovaTrip
- JWT_SECRET=YOUR_JWT_SECRET
- FRONTEND_URL=http://localhost:3000

## 프로젝트를 통해 얻은 점
- MongoDB 기반 도메인 중심 DB 설계 경험
- 게시판 기능 구현을 통한 CRUD + 파일 처리 실전 경험
- 팀 프로젝트에서 코드 병합·충돌 해결 경험
- 기능 구현뿐 아니라 유지보수성과 구조를 고려한 개발 사고

## 참고
본 프로젝트는 학습 및 포트폴리오 목적의 팀 프로젝트이며,
실제 서비스 흐름을 고려한 구조로 구현되었습니다.
