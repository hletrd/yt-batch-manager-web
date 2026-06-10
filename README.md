# YT Batch Manager Web

![YT Batch Manager](./docs/shot0.png)

![Edit](./docs/shot1.png)

![Light](./docs/shot2.png)

## [Go to the app](https://yt.atik.kr/)

* [Privacy Policy](https://yt.atik.kr/privacy.html)
* [Terms of Service](https://yt.atik.kr/terms.html)

## About

As both YouTube studio webpage and YT studio mobile app does not provide a convinient user experiences for batch editing video titles and descriptions, I had to make this app to manage titles and descriptions of my videos in a single place.

This is a web port of an [Electron port, as a standalone app](https://github.com/hletrd/yt-batch-manager), of [yt-batch-manager-py](https://github.com/hletrd/yt-batch-manager-py).

* Disclaimer: YouTube is a registered trademark of Google LLC, and this project is not affiliated with YouTube in any way.

## 설명

유튜브 채널의 영상 제목과 설명을 한 페이지에서 바로 수정하고 관리할 수 있는 앱입니다.

유튜브 채널에서 영상 제목과 설명을 한 번에 수정할 때 각 영상에 하나하나 들어가서 확인하고 수정해야 하는 게 너무 킹받아서 만들었습니다. 웹 페이지든 YT Studio 모바일 앱이든 왜 영상 제목과 설명을 한 번에 나열해서 수정할 수 있는 기능이 없는건지 모르겠습니다. 원래 [Python으로 만들었다가](https://github.com/hletrd/yt-batch-manager-py) 별도 데스크탑 앱이 편할 것 같아 [Electron으로 다시 만들었다가](https://github.com/hletrd/yt-batch-manager) 웹 페이지가 편한 것 같아 웹으로 다시 옮겼습니다.

---

## Features

* Edit video titles and descriptions in a single page, which YouTube does not allow.
  * YouTube forces a very user-unfriendly experiences, where you have to go to each video page to edit the title and description, and then save it.
* Bulk-edit privacy status, category, audio language, and tags as well.
* Set the recording date and recording location (latitude/longitude) per video, with a use-current-location button and a view-on-map link.
* Change the license (Standard YouTube License / Creative Commons) and the title/description language.
* Toggle the "altered or synthetic content" (AI) disclosure per video.
* Copy a video's tags to the clipboard with one click.
* Likely YouTube Shorts (vertical/square and 3 minutes or shorter) are flagged with a badge.
* Loads every video in the channel, not just the most recent ones.
* Save/load video data to/from local JSON files for offline editing and backup. Exports include every editable field (unset values as `null`) so the file doubles as a fill-in template; imported backups are validated and sanitized before anything is rendered or saved.
* Stays signed in across reloads — the session is restored automatically, so you don't have to log in again every hour.

## 기능 (한국어)

* 유튜브 채널의 영상 하나하나를 각각 열지 않아도 한 번에 영상 제목과 설명을 편집할 수 있습니다.
  * 이거 유튜브 Studio 웹페이지나 YT Studio 앱에서는 안 됩니다. 대체 왜 안 되는지 모르겠습니다.
* 영상 제목과 설명을 JSON으로 저장하고 불러올 수 있습니다. 내보낸 JSON에는 모든 편집 가능 항목이 포함되며(미설정 값은 `null`), 불러온 백업은 렌더링·저장 전에 검증/정제됩니다.
* 영상 공개 설정 / 카테고리 / 언어 / 태그 등도 한 번에 편집할 수 있습니다.
* 영상별 촬영일과 촬영 장소(위도/경도)를 설정할 수 있습니다. 현재 위치 버튼과 지도에서 보기 링크도 제공됩니다.
* 라이선스(표준 YouTube / 크리에이티브 커먼즈)와 제목·설명 언어를 변경할 수 있습니다.
* 영상별로 '변경되거나 합성된 콘텐츠(AI)' 공개 여부를 설정할 수 있습니다.
* 버튼 한 번으로 영상의 태그를 클립보드에 복사할 수 있습니다.
* 쇼츠로 추정되는 영상(세로/정사각형이면서 3분 이하)에는 배지가 표시됩니다.
* 최근 영상만이 아니라 채널의 모든 영상을 불러옵니다.
* 새로고침하거나 다시 접속해도 로그인이 유지되어, 한 시간마다 다시 로그인할 필요가 없습니다.

---

## Guide for developers

### Prerequisites

* Node.js 24 LTS installed (the project builds on Node 24).
* Google Cloud Console project with YouTube Data API v3 enabled.
* Your own YouTube channel.

### Setup

#### Install dependencies

```bash
$ npm install
```

#### Google API setup

##### Create a new project
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project, name it whatever you want.
3. Search for the **YouTube Data API v3** in the search bar, and enable it.
4. Search for the **OAuth consent screen** in the search bar, and navigate into it.
5. Click 'Get started'. Fill in the app name as whatever you want and user support email as your email address. Set audience to 'External'. Input your email addreess in 'Contact information'. Agree to the usage policy, and tap 'Create'.
6. click 'Clients' on the left sidebar.
7. Create a new client app as a web app, name it whatever you want.
   * **Important:** restrict the client's **Authorized JavaScript origins** and **Authorized redirect URIs** to the exact domain where you deploy the app (e.g. `https://your-domain.example`). Because this is a browser-only app, the OAuth `client_secret` ships to the client; locking the origins/redirect URIs is what keeps that secret from being usable elsewhere (PKCE is also enforced by the app).
8. Download the credentials JSON file, and rename it to `credentials.json`. Put it in the directory `src/`.

##### Add scopes
1. Search for the **OAuth consent screen** in the search bar, and click 'Data Access' on the left sidebar.
2. Click 'Add or remove scopes' and enter the following scope in **Manually add scopes** text box:
```
https://www.googleapis.com/auth/youtube.force-ssl
```
3. Click 'Add to table'.
4. Click 'Update'.
5. Click 'Save'.

##### Add yourself as a test user
1. Search for the **OAuth consent screen** in the search bar, and click 'Audience' on the left sidebar.
2. Click 'Add user' under 'Test users' and enter your email address.

#### Run the application (for development)

```bash
npm run dev
```

The application will launch and prompt for Google OAuth authentication on first run.

---

## Troubleshooting

### Google OAuth authentication fails
1. Remove the stored credentials by clicking the "Remove Saved Credentials" button and reload the file.
2. If the problem persists, try to re-create the `credentials.json` file.

### "403 Forbidden" / quota exceeded when loading videos
The YouTube Data API has a default quota of 10,000 units/day. The app lists your uploads efficiently (about 9 units per full load), so this is rarely hit. If you do see a `403 quotaExceeded`, the daily quota resets at midnight Pacific Time, or you can request a higher quota in the Google Cloud Console.
