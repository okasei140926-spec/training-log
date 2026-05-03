# Getting Started with Create React App

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

## Production Environment Variables

### Frontend build-time variables

- `REACT_APP_SUPABASE_URL`
- `REACT_APP_SUPABASE_ANON_KEY`
- `REACT_APP_VAPID_PUBLIC_KEY`

`REACT_APP_VAPID_PUBLIC_KEY` is required at build time. Make sure it is set in Vercel Production before deploying.

### Server / API variables

- `SUPABASE_SERVICE_ROLE_KEY`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- `CLAUDE_API_KEY`
- `CRON_SECRET`

### Notes

- Push test notifications, friend notifications, overtake notifications, and inactivity notifications require the VAPID and Supabase server-side keys.
- `/api/send-inactivity-push` is scheduled by `vercel.json`, so `CRON_SECRET` must be set in Vercel for the cron job to work safely.
- `CLAUDE_API_KEY` should be configured as a sensitive server-side environment variable only.

## Vercel Cron

`vercel.json` に毎日10:00 UTCで `send-inactivity-push` を設定しています。

Vercel ダッシュボード → Settings → Cron Jobs で実行ログを確認できます。
手動で即時実行したい場合は Cron Jobs 画面の「Run」ボタンを使ってください。
認証には `Authorization: Bearer <CRON_SECRET>` ヘッダーが必要です。

## notification_events テーブルの確認

Supabase ダッシュボード → Table Editor → `notification_events` で通知送信ログを確認できます。

- `dedupe_key` カラムで重複防止（同一ユーザー・同一イベントは1回のみ）
- `sent_at` が `null` の場合は配信失敗（デバイスへの到達失敗）
- 古いイベントは定期的に手動削除してください（現時点で自動クリーンアップなし）

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)
