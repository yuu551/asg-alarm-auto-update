# AWS CodeDeploy & CloudWatch アラーム自動更新システム

このレポジトリは、AWS CDK（Cloud Development Kit）を使用して、インフラストラクチャをデプロイするためのサンプルコードです。特に、CodeDeployを手動で設定し、デプロイ成功時にSNS通知をトリガーとして、Lambda関数を使ってCloudWatchアラームを自動的に更新する仕組みを実装したデモンストレーションとなっています。

## レポジトリ概要

このレポジトリは、AWS CDKを使用したインフラと、CodeDeployデプロイ成功時のCloudWatchアラーム自動更新の仕組みを提供します。

- **CDK実装（`lib/`配下）**: VPC、ALB、Auto Scaling Group、EC2インスタンス、セキュリティグループ、SNSトピック、Lambda関数などのインフラリソースを自動構築
- **Lambda実装（`lambda/`配下）**: デプロイ成功時にCloudWatchアラームを動的に更新するロジック
- **手動設定要素**: CodeDeployアプリケーションとデプロイグループは手動で作成し、デプロイ成功イベント通知先としてSNSトピックを設定

### 特徴：CodeDeployと連携したアラーム自動更新の仕組み

このサンプルの特徴は、**CodeDeployを手動でデプロイ成功のトリガーを設定し、デプロイ成功時にSNSトピックを介してLambda関数を起動し、CloudWatchアラームの設定を自動的に更新する仕組み**を実装している点です。これにより下記を実現します。

1. デプロイ成功の通知がSNSトピックに送信される
2. 通知を受け取ったLambda関数が、新しいアプリケーションバージョンに適したCloudWatchアラームの閾値に自動的に更新する

このパターンは、CI/CDパイプラインの一部として組み込むことで、デプロイと監視の連携を強化するための実用的な参考例となります。

## 前提条件

このプロジェクトをデプロイするためには以下が必要です：

- [Node.js](https://nodejs.org/) 18.x 以上
- [AWS CDK](https://aws.amazon.com/cdk/) がインストールされていること

## セットアップと初期化

1. リポジトリのクローン
```bash
git clone <リポジトリURL>
cd autoScaling
```

2. 依存関係のインストール
```bash
npm install
```

3. AWS CDKの初期化（初回のみ）
```bash
cdk bootstrap
```

## デプロイ手順

1. CDKスタックのデプロイ
```bash
cdk deploy
```

2. デプロイ中に作成されたリソースの確認
```bash
cdk list
```

3. CloudFormationコンソールでスタックの状態を確認

## CodeDeployの手動設定

CDKでデプロイした後、以下の手動設定が必要です：

1. AWS Management Consoleにログイン
2. CodeDeployコンソールに移動し、新しいアプリケーションを作成
3. デプロイグループを作成し、CDKで作成したAutoScalingGroup、ALBを選択
4. デプロイグループのトリガー設定で「成功時の通知」を有効化し、SNSトピックを選択
   - 対象のSNSトピックはCDKスタックでデプロイされたもの

## デプロイ後の動作確認

1. CodeDeployコンソールでデプロイの進捗を確認
2. デプロイが成功すると、SNS通知が発行され、Lambda関数が起動
3. CloudWatchアラームコンソールで、アラームが適切に更新されていることを確認

## クリーンアップ

作成したリソースを削除：

```bash
cdk destroy
```

※注意：CDKで作成されなかったリソース（手動作成したCodeDeployアプリケーションなど）は手動で削除が必要です。