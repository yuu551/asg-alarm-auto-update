// アラーム設定を定義
export const ALARM_CONFIGS = {
    CPU: {
        prefix: 'ASG-HighCPUUtilization',
        description: 'Alarm when CPU exceeds 70%',
        metricName: 'CPUUtilization',
        namespace: 'AWS/EC2',
        statistic: 'Average',
        period: 300,
        threshold: 70,
        comparisonOperator: 'GreaterThanThreshold',
        evaluationPeriods: 2
    },
    StatusCheck: {
        prefix: 'ASG-StatusCheckFailed',
        description: 'Monitor status checks for the AutoScalingGroup',
        metricName: 'StatusCheckFailed',
        namespace: 'AWS/EC2',
        statistic: 'Maximum',
        period: 300,
        threshold: 1,
        comparisonOperator: 'GreaterThanOrEqualToThreshold',
        evaluationPeriods: 2
    },
    Memory: {
        prefix: 'ASG-HighMemoryUtilization',
        description: 'アラーム：メモリ使用率が70%を超えた場合',
        metricName: 'mem_used_percent',
        namespace: 'CWAgent',
        statistic: 'Average',
        period: 300,
        threshold: 70,
        comparisonOperator: 'GreaterThanThreshold',
        evaluationPeriods: 2
    }
}; 