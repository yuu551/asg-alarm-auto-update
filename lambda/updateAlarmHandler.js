import { CloudWatch } from '@aws-sdk/client-cloudwatch';
import { ALARM_CONFIGS } from './alarmConfigs.js';

const cloudwatch = new CloudWatch({ region: 'ap-northeast-1' });

// 再帰的にアラームを取得する関数
async function getAllAlarms(params, allAlarms = []) {
    const response = await cloudwatch.describeAlarms(params);
    
    const updatedAlarms = response.MetricAlarms 
        ? [...allAlarms, ...response.MetricAlarms]
        : allAlarms;

    if (response.NextToken) {
        return getAllAlarms(
            { ...params, NextToken: response.NextToken },
            updatedAlarms
        );
    }

    return updatedAlarms;
}

// アラームを作成する関数
async function createMetricAlarm(metricType, deploymentId, autoScalingGroupName) {
    if (!ALARM_CONFIGS[metricType]) {
        throw new Error(`未定義のメトリクスタイプ: ${metricType}`);
    }
    
    const config = ALARM_CONFIGS[metricType];
    
    const params = {
        AlarmName: `${config.prefix}-${deploymentId}`,
        AlarmDescription: config.description,
        MetricName: config.metricName,
        Namespace: config.namespace,
        Statistic: config.statistic,
        Period: config.period,
        Threshold: config.threshold,
        ComparisonOperator: config.comparisonOperator,
        EvaluationPeriods: config.evaluationPeriods,
        Dimensions: [{
            Name: 'AutoScalingGroupName',
            Value: autoScalingGroupName
        }],
        AlarmActions: ['arn:aws:sns:ap-northeast-1:034362035978:anomaly_detection']
    };
    
    return cloudwatch.putMetricAlarm(params);
}

// 既存のアラームを削除する関数
async function deleteExistingAlarms(metricType, deploymentId) {
    if (!ALARM_CONFIGS[metricType]) {
        throw new Error(`未定義のメトリクスタイプ: ${metricType}`);
    }
    
    const config = ALARM_CONFIGS[metricType];
    const prefix = `${config.prefix}-`;
    
    try {
        const listAlarmsParams = {
            AlarmNamePrefix: prefix,
            MaxRecords: 100
        };
        
        const allAlarms = await getAllAlarms(listAlarmsParams);
        
        const alarmsToDelete = allAlarms
            .filter(alarm => 
                alarm.AlarmName.startsWith(prefix) &&
                alarm.Dimensions.some(dim => 
                    dim.Name === 'AutoScalingGroupName'
                )
            )
            .map(alarm => alarm.AlarmName);
        
        if (alarmsToDelete.length > 0) {
            await cloudwatch.deleteAlarms({
                AlarmNames: alarmsToDelete
            });
            console.log(`削除された既存の${metricType}アラーム:`, alarmsToDelete);
        }
    } catch (deleteError) {
        console.warn(`既存の${metricType}アラーム削除中のエラー:`, deleteError);
    }
}

export const handler = async (event) => {
    try {
        console.log('受信イベント:', JSON.stringify(event, null, 2));
        
        // SNSメッセージからデプロイメント情報を取得
        const snsMessage = JSON.parse(event.Records[0].Sns.Message);
        
        // デプロイメント情報を取得
        const deploymentId = snsMessage.deploymentId;
        const applicationName = snsMessage.applicationName;
        const deploymentGroupName = snsMessage.deploymentGroupName;
        
        // AutoScalingGroup名を構築
        const autoScalingGroupName = `CodeDeploy_${deploymentGroupName}_${deploymentId}`;
        
        // 使用するメトリクスタイプを設定（メモリを追加）
        const metricTypes = ['CPU', 'StatusCheck', 'Memory'];
        
        const results = {};
        
        // 各メトリクスタイプに対してアラームを設定
        for (const metricType of metricTypes) {
            // 既存のアラームを削除
            await deleteExistingAlarms(metricType, deploymentId);
            
            // 新しいアラームを作成
            const result = await createMetricAlarm(metricType, deploymentId, autoScalingGroupName);
            console.log(`新しい${metricType}アラームが正常に作成されました:`, result);
            
            results[metricType] = {
                alarmName: `${ALARM_CONFIGS[metricType].prefix}-${deploymentId}`,
                status: 'created'
            };
        }
        
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'CloudWatch アラームが正常に作成されました',
                autoScalingGroupName: autoScalingGroupName,
                alarms: results
            })
        };
        
    } catch (error) {
        console.error('エラー:', error);
        throw error;
    }
};