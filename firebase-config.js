/* Firebase の接続設定（Firebaseコンソール → プロジェクトの設定 → マイアプリ に表示される値）
   この値は公開ページに置く前提のもので、見られても問題ありません。
   データを守るのは database.rules.json（Firebaseコンソールの「ルール」に貼り付ける）です。
   databaseURL は Realtime Database の画面の上部に表示される URL と同じであること。 */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCHGEJ6fIjvXl7WDSxWGwlY4vCKLmpu2dU",
  authDomain: "timetable-69cee.firebaseapp.com",
  databaseURL: "https://timetable-69cee-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "timetable-69cee",
  storageBucket: "timetable-69cee.firebasestorage.app",
  messagingSenderId: "216811889817",
  appId: "1:216811889817:web:8d27547433b93b12214408"
};
