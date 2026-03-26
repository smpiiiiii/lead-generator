// GitHubリポジトリ作成スクリプト
const https = require('https');

// Gitの認証情報を使ってリポジトリ作成
const data = JSON.stringify({
  name: 'lead-generator',
  description: '営業リスト作成ツール',
  'private': false,
  auto_init: false
});

// git configからtokenを取得する方法が分からないので
// git pushで403が出たらリポジトリがないことがわかる
console.log('リポジトリを作成するには以下のURLで手動作成してください:');
console.log('https://github.com/new');
console.log('');
console.log('リポジトリ名: lead-generator');
console.log('公開設定: Public');
console.log('READMEで初期化: しない');
console.log('');
console.log('作成後、以下のコマンドでpush:');
console.log('cd C:\\Users\\torit\\.gemini\\antigravity\\scratch\\lead-generator');
console.log('git push -u origin master');
