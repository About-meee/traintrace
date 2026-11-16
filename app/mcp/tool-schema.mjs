export const TRAINING_RECORDS_TOOL = {
  name: "get_training_records",
  description:
    "只读查询当前已验证 Sites 账号自己的 TRAINTRACE 训练记录。date_range 要求 fromDate 和 throughDate 两端日期（含）均提供；all 必须由用户明确要求并省略两个日期，不能默认读取全部。每次最多返回一页；继续读取时将 nextCursor 原样作为 cursor，并保持相同模式、日期和 limit。将‘今天’、‘近一周’、‘两周前’、‘本月’等自然语言转换为实际日期范围；对比两个时段时分别查询两个闭区间。为完整汇总所选范围，持续读取后续页直到 hasMore=false。若工具调用中途失败，应说明汇总只覆盖已成功读取的记录。",
  inputSchema: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["date_range", "all"],
        description:
          "必填。date_range 按记录的本地 date 字段闭区间筛选；all 显式读取全部历史，并省略 fromDate/throughDate。",
      },
      fromDate: {
        type: "string",
        format: "date",
        description: "date_range 必填，YYYY-MM-DD，真实日历日期。",
      },
      throughDate: {
        type: "string",
        format: "date",
        description:
          "date_range 必填，YYYY-MM-DD，真实日历日期，且不早于 fromDate。",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 20,
        description: "每页条数；默认 10，最大 20。翻页时保持与首请求相同。",
      },
      cursor: {
        type: "string",
        description: "可选的续页游标，只能原样使用上一页 nextCursor；不可修改。",
      },
    },
    required: ["mode"],
    additionalProperties: false,
  },
};

