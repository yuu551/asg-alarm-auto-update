import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
import * as iam from "aws-cdk-lib/aws-iam";
import * as elb from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as path from "path";
import * as fs from "fs";
import * as archiver from "archiver"; // npm install archiver が必要です
import * as sns from "aws-cdk-lib/aws-sns";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";

export class AutoScalingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPCの作成
    const vpc = new ec2.Vpc(this, "MyVPC", {
      maxAzs: 2,
      natGateways: 1, // NAT Gatewayを追加（プライベートサブネットからのインターネットアクセス用）
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "Public",
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: "Private",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, // NAT Gatewayを使用するように変更
        },
      ],
    });

    // ALBのセキュリティグループ
    const albSecurityGroup = new ec2.SecurityGroup(this, "ALBSecurityGroup", {
      vpc,
      allowAllOutbound: true,
      description: "Security group for ALB",
    });

    // インターネットからALBへのHTTPトラフィックを許可
    albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      "Allow HTTP traffic from internet"
    );

    // ALBの設定を更新
    const alb = new elb.ApplicationLoadBalancer(this, "ALB", {
      vpc,
      internetFacing: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroup: albSecurityGroup,
    });

    // ALBのリスナーとターゲットグループの作成
    const listener = alb.addListener("Listener", {
      port: 80,
    });

    // EC2インスタンスのIAMロール
    const ec2Role = new iam.Role(this, "EC2Role", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSCodeDeployRole"
        ),
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonSSMManagedInstanceCore"
        ),
        // S3アクセス用のポリシーを追加
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonS3ReadOnlyAccess"),
        // CloudWatch Agentのポリシーを追加
        iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchAgentServerPolicy"),
      ],
    });

    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      "#!/bin/bash",
      "exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1",

      // システムアップデートとベースパッケージのインストール
      "dnf update -y",
      "dnf install -y httpd ruby wget",

      // アプリケーションディレクトリの作成
      "mkdir -p /var/www/html",
      "mkdir -p /opt/codedeploy-agent/deployment-root",

      // 初期のindex.htmlを作成
      "cat << 'EOF' > /var/www/html/index.html",
      "<h1>Hello from EC2 - Initial Setup</h1>",
      "EOF",

      // デプロイ用スクリプトディレクトリの作成
      "mkdir -p /opt/deployment/scripts",

      // stop_application.shの作成
      "cat << 'EOF' > /opt/deployment/scripts/stop_application.sh",
      "#!/bin/bash",
      "systemctl stop httpd",
      "EOF",

      // start_application.shの作成
      "cat << 'EOF' > /opt/deployment/scripts/start_application.sh",
      "#!/bin/bash",
      "systemctl start httpd",
      "EOF",

      // validate_service.shの作成
      "cat << 'EOF' > /opt/deployment/scripts/validate_service.sh",
      "#!/bin/bash",
      "curl -f http://localhost/",
      "EOF",

      // スクリプトに実行権限を付与
      "chmod +x /opt/deployment/scripts/*.sh",

      // CodeDeployエージェントのインストール
      "cd /home/ec2-user",
      `wget https://aws-codedeploy-${cdk.Stack.of(this).region}.s3.${
        cdk.Stack.of(this).region
      }.amazonaws.com/latest/install`,
      "chmod +x ./install",
      "./install auto",

      // CloudWatch Agentのインストールと設定
      // Amazon Linux 2023用のインストール方法
      "dnf install -y amazon-cloudwatch-agent",
      
      // CloudWatch Agent設定ファイルの作成
      "mkdir -p /opt/aws/amazon-cloudwatch-agent/etc",
      "cat << 'EOF' > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json",
      "{",
      '  "agent": {',
      '    "metrics_collection_interval": 60,',
      '    "run_as_user": "root"',
      '  },',
      '  "metrics": {',
      '    "namespace": "CWAgent",',
      '    "metrics_collected": {',
      '      "mem": {',
      '        "measurement": [',
      '          "mem_used_percent"',
      '        ],',
      '        "metrics_collection_interval": 60',
      '      },',
      '      "swap": {',
      '        "measurement": [',
      '          "swap_used_percent"',
      '        ],',
      '        "metrics_collection_interval": 60',
      '      },',
      '      "disk": {',
      '        "measurement": [',
      '          "used_percent"',
      '        ],',
      '        "resources": [',
      '          "/"',
      '        ],',
      '        "metrics_collection_interval": 60',
      '      }',
      '    },',
      '    "append_dimensions": {',
      '      "AutoScalingGroupName": "${aws:AutoScalingGroupName}",',
      '      "InstanceId": "${aws:InstanceId}",',
      '      "InstanceType": "${aws:InstanceType}"',
      '    },',
      '    "aggregation_dimensions": [',
      '      ["AutoScalingGroupName"]',
      '    ]',
      '  }',
      "}",
      "EOF",

      // CloudWatch Agentの起動
      "/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json",

      // サービスの起動
      "systemctl start codedeploy-agent",
      "systemctl start httpd",
      "systemctl enable httpd",
      "systemctl enable codedeploy-agent",
      "systemctl enable amazon-cloudwatch-agent"
    );

    // Auto Scaling グループの作成
    const asg = new autoscaling.AutoScalingGroup(this, "ASG", {
      vpc,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO
      ),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      minCapacity: 1,
      maxCapacity: 3,
      desiredCapacity: 1,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      role: ec2Role,
      // Webサーバーの設定を追加
      userData: userData,
      securityGroup: new ec2.SecurityGroup(this, "ASGSecurityGroup", {
        vpc,
        allowAllOutbound: true,
      }),
      // メモリ使用率などのメトリクスを有効化
      groupMetrics: [autoscaling.GroupMetrics.all()],
    });

    // セキュリティグループの設定
    asg.connections.allowFrom(alb, ec2.Port.tcp(80));

    // ALBターゲットグループにASGを追加
    listener.addTargets("WebFleet", {
      port: 80,
      targets: [asg],
      healthCheck: {
        path: "/",
        healthyHttpCodes: "200",
      },
    });

    // Auto Scaling ポリシーの追加
    asg.scaleOnCpuUtilization("CpuScaling", {
      targetUtilizationPercent: 30,
      cooldown: cdk.Duration.seconds(300),
    });



    // CodeDeployのロール
    const deployRole = new iam.Role(this, "CodeDeployServiceRole", {
      assumedBy: new iam.ServicePrincipal("codedeploy.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSCodeDeployRole"
        ),
      ],
      // インラインポリシーを追加
      inlinePolicies: {
        AutoScalingAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "autoscaling:CompleteLifecycleAction",
                "autoscaling:DeleteLifecycleHook",
                "autoscaling:DescribeAutoScalingGroups",
                "autoscaling:DescribeLifecycleHooks",
                "autoscaling:PutLifecycleHook",
                "autoscaling:RecordLifecycleActionHeartbeat",
                "autoscaling:CreateAutoScalingGroup",
                "autoscaling:UpdateAutoScalingGroup",
                "autoscaling:EnableMetricsCollection",
                "autoscaling:DescribePolicies",
                "autoscaling:DescribeScheduledActions",
                "autoscaling:DescribeNotificationConfigurations",
                "autoscaling:SuspendProcesses",
                "autoscaling:ResumeProcesses",
                "autoscaling:AttachLoadBalancers",
                "autoscaling:DetachLoadBalancers",
                "autoscaling:PutScalingPolicy",
                "autoscaling:DeletePolicy",
                "autoscaling:PutNotificationConfiguration",
                "autoscaling:DeleteNotificationConfiguration",
              ],
              resources: ["*"],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "elasticloadbalancing:DescribeLoadBalancers",
                "elasticloadbalancing:DescribeInstanceHealth",
                "elasticloadbalancing:RegisterInstancesWithLoadBalancer",
                "elasticloadbalancing:DeregisterInstancesFromLoadBalancer",
                "elasticloadbalancing:DescribeTargetGroups",
                "elasticloadbalancing:DescribeTargetHealth",
                "elasticloadbalancing:RegisterTargets",
                "elasticloadbalancing:DeregisterTargets",
              ],
              resources: ["*"],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "ec2:Describe*",
                "iam:PassRole",
                "ec2:CreateTags",
                "ec2:RunInstances",
              ],
              resources: ["*"],
            }),
          ],
        }),
      },
    });

    // デプロイメント用のS3バケットを作成
    const deploymentBucket = new s3.Bucket(this, "DeploymentBucket", {
      removalPolicy: cdk.RemovalPolicy.DESTROY, // テスト用。本番環境では要検討
      autoDeleteObjects: true, // テスト用。本番環境では要検討
    });

    // デプロイファイルを作成する関数
    const createDeploymentFiles = async () => {
      // 一時ディレクトリを作成
      const tempDir = path.join(__dirname, "temp-deploy");
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      // アプリケーションディレクトリ構造を作成
      const appDir = path.join(tempDir, "your-app");
      const scriptsDir = path.join(appDir, "scripts");
      const srcDir = path.join(appDir, "src");

      fs.mkdirSync(appDir, { recursive: true });
      fs.mkdirSync(scriptsDir, { recursive: true });
      fs.mkdirSync(srcDir, { recursive: true });

      // appspec.ymlを作成
      // appspec.ymlを作成
      const appspecContent = `version: 0.0
os: linux
files:
  - source: /src
    destination: /var/www/html/
permissions:
  - object: /var/www/html
    pattern: "**"
    owner: apache
    group: apache
    mode: 755
    type:
      - directory
  - object: /var/www/html
    pattern: "**"
    owner: apache
    group: apache
    mode: 644
    type:
      - file
hooks:
  BeforeInstall:
    - location: scripts/stop_application.sh
      timeout: 300
      runas: root
  AfterInstall:
    - location: scripts/start_application.sh
      timeout: 300
      runas: root
  ValidateService:
    - location: scripts/validate_service.sh
      timeout: 300
      runas: root`;

      fs.writeFileSync(path.join(appDir, "appspec.yml"), appspecContent);

      // スクリプトファイルを作成
      const stopScript = `#!/bin/bash
service httpd stop
rm -rf /var/www/html/*`; // 既存ファイルの削除を追加

      const startScript = `#!/bin/bash
service httpd start`;

      const validateScript = `#!/bin/bash
curl -f http://localhost/`;

      fs.writeFileSync(
        path.join(scriptsDir, "stop_application.sh"),
        stopScript
      );
      fs.writeFileSync(
        path.join(scriptsDir, "start_application.sh"),
        startScript
      );
      fs.writeFileSync(
        path.join(scriptsDir, "validate_service.sh"),
        validateScript
      );

      // index.htmlを作成
      const indexContent = `<!DOCTYPE html>
<html>
<head>
    <title>My Application</title>
</head>
<body>
    <h1>Hello from CodeDeploy!</h1>
    <p>This is a deployed version.</p>
</body>
</html>`;

      fs.writeFileSync(path.join(srcDir, "index.html"), indexContent);

      // ZIPファイルを作成
      return new Promise<string>((resolve, reject) => {
        const zipPath = path.join(tempDir, "application.zip");
        const output = fs.createWriteStream(zipPath);
        const archive = archiver("zip");

        output.on("close", () => resolve(zipPath));
        archive.on("error", reject);

        archive.pipe(output);
        archive.directory(appDir, false);
        archive.finalize();
      });
    };

    // デプロイファイルを作成してS3にアップロード
    createDeploymentFiles().then((zipPath) => {
      new s3deploy.BucketDeployment(this, "DeploymentZip", {
        sources: [s3deploy.Source.asset(path.dirname(zipPath))],
        destinationBucket: deploymentBucket,
        destinationKeyPrefix: "deployments",
      });
    });

    // ALBのDNS名を出力
    new cdk.CfnOutput(this, "LoadBalancerDNS", {
      value: alb.loadBalancerDnsName,
    });

    // SNSトピックの作成
    const deploymentTopic = new sns.Topic(this, "DeploymentNotificationTopic", {
      displayName: "CodeDeployデプロイ通知トピック",
      topicName: "codedeploy-deployment-notifications",
    });

    // Lambda関数のIAMロール作成
    const lambdaRole = new iam.Role(this, "UpdateAlarmHandlerRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
      ],
      inlinePolicies: {
        CloudWatchAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "cloudwatch:DescribeAlarms",
                "cloudwatch:PutMetricAlarm",
                "cloudwatch:DeleteAlarms",
              ],
              resources: ["*"],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "sns:Publish",
              ],
              resources: ["*"],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "codedeploy:GetDeployment",
                "codedeploy:GetDeploymentConfig",
                "codedeploy:GetDeploymentGroup",
                "codedeploy:ListDeployments",
              ],
              resources: ["*"],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "autoscaling:DescribeAutoScalingGroups",
              ],
              resources: ["*"],
            }),
          ],
        }),
      },
    });

    // lambda関数を使用
    const updateAlarmHandler = new lambdaNodejs.NodejsFunction(this, "UpdateAlarmHandler", {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, "../lambda/updateAlarmHandler.js"),
      handler: "handler",
      timeout: cdk.Duration.seconds(60),
      role: lambdaRole,
    });

    // SNSトピックにLambda関数をサブスクライブ
    deploymentTopic.addSubscription(
      new subscriptions.LambdaSubscription(updateAlarmHandler)
    );
  }
}
