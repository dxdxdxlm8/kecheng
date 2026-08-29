import { sql } from "drizzle-orm";
import { pgTable, serial, text, varchar, timestamp, integer, real, boolean, jsonb, index } from "drizzle-orm/pg-core";
import { createSchemaFactory } from "drizzle-zod";
import { z } from "zod";

export const healthCheck = pgTable("health_check", {
  id: serial().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

// 学生表
export const students = pgTable(
  "students",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    name: varchar("name", { length: 128 }).notNull(),
    // 学伴水平：normal（普通，与学生水平相当）| advanced（高水平）
    companion_level: varchar("companion_level", { length: 20 }).notNull().default("normal"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("students_name_idx").on(table.name),
    index("students_created_at_idx").on(table.created_at),
  ]
);

// 知识点表
export const knowledgePoints = pgTable(
  "knowledge_points",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    title: varchar("title", { length: 255 }).notNull(),
    content: text("content").notNull(),
    image_key: varchar("image_key", { length: 512 }),
    created_by: varchar("created_by", { length: 255 }).notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("knowledge_points_created_by_idx").on(table.created_by),
    index("knowledge_points_created_at_idx").on(table.created_at),
  ]
);

// 题目表
export const questions = pgTable(
  "questions",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    question_text: text("question_text").notNull(),
    answer: text("answer").notNull(),
    question_type: varchar("question_type", { length: 50 }).notNull().default("choice"),
    options: jsonb("options"),
    knowledge_point_id: varchar("knowledge_point_id", { length: 36 }).references(() => knowledgePoints.id, { onDelete: "cascade" }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("questions_knowledge_point_id_idx").on(table.knowledge_point_id),
    index("questions_question_type_idx").on(table.question_type),
  ]
);

// 教师 Prompt 表（原 guidance_scripts 改造而来，全局一份教师教学策略 Prompt）
// 保留原表名以兼容存量数据，语义变更为"全局教师 Prompt"
export const guidanceScripts = pgTable(
  "guidance_scripts",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    title: varchar("title", { length: 255 }).notNull().default("教师 Prompt"),
    content: text("content").notNull(),
    // 保留字段以兼容，不再使用
    step_order: integer("step_order").notNull().default(1),
    knowledge_point_id: varchar("knowledge_point_id", { length: 36 }).references(() => knowledgePoints.id, { onDelete: "cascade" }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("guidance_scripts_knowledge_point_id_idx").on(table.knowledge_point_id),
    index("guidance_scripts_step_order_idx").on(table.step_order),
  ]
);

// 会话状态表：管理双 Agent 教学流程的状态机
export const sessionStates = pgTable(
  "session_states",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    session_id: varchar("session_id", { length: 64 }).notNull(),
    student_id: varchar("student_id", { length: 36 }).notNull().references(() => students.id, { onDelete: "cascade" }),
    // teaching: 教师引导/出题 | discussing: 学伴讨论 | answering: 学生答题中 | judging: 教师判题 | summarizing: 教师生成总结 | finished: 已结束
    phase: varchar("phase", { length: 30 }).notNull().default("teaching"),
    question_index: integer("question_index").notNull().default(0),
    total_questions: integer("total_questions").notNull().default(0),
    correct_count: integer("correct_count").notNull().default(0),
    current_question_text: text("current_question_text"),
    current_answer: text("current_answer"),
    current_knowledge_point_id: varchar("current_knowledge_point_id", { length: 36 }),
    current_difficulty: varchar("current_difficulty", { length: 20 }).notNull().default("basic"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("session_states_session_id_idx").on(table.session_id),
    index("session_states_student_id_idx").on(table.student_id),
  ]
);

// 互动记录表
// role 扩展为：student（学生）| teacher（教师 Agent）| companion（学伴 Agent）
// 旧数据中的 user/assistant 仍可兼容读取
export const interactionRecords = pgTable(
  "interaction_records",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    student_id: varchar("student_id", { length: 36 }).notNull().references(() => students.id, { onDelete: "cascade" }),
    session_id: varchar("session_id", { length: 64 }).notNull(),
    role: varchar("role", { length: 20 }).notNull(),
    content: text("content").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("interaction_records_student_id_idx").on(table.student_id),
    index("interaction_records_session_id_idx").on(table.session_id),
    index("interaction_records_created_at_idx").on(table.created_at),
  ]
);

// 答题记录表
export const answerRecords = pgTable(
  "answer_records",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    student_id: varchar("student_id", { length: 36 }).notNull().references(() => students.id, { onDelete: "cascade" }),
    // question_id 存储练习序号标记(exercise_1/2/3)，不再引用 questions.id
    question_id: varchar("question_id", { length: 36 }),
    session_id: varchar("session_id", { length: 64 }).notNull(),
    student_answer: text("student_answer").notNull(),
    is_correct: boolean("is_correct").notNull().default(false),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("answer_records_student_id_idx").on(table.student_id),
    index("answer_records_session_id_idx").on(table.session_id),
    index("answer_records_question_id_idx").on(table.question_id),
  ]
);

// 系统设置表：大模型 / 对象存储配置（教师端「系统设置」页面维护）
// 逻辑上仅保留一条记录；所有字段可空，空值回退到服务端环境变量
export const systemSettings = pgTable("system_settings", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  llm_base_url: text("llm_base_url"),
  llm_api_key: text("llm_api_key"),
  llm_model: text("llm_model"),
  llm_vision_model: text("llm_vision_model"),
  llm_temperature: real("llm_temperature"),
  llm_max_tokens: integer("llm_max_tokens"),
  llm_timeout_ms: integer("llm_timeout_ms"),
  llm_extra_headers: text("llm_extra_headers"),
  storage_endpoint: text("storage_endpoint"),
  storage_region: text("storage_region"),
  storage_bucket: text("storage_bucket"),
  storage_access_key: text("storage_access_key"),
  storage_secret_key: text("storage_secret_key"),
  storage_public_base_url: text("storage_public_base_url"),
  storage_force_path_style: boolean("storage_force_path_style").default(true),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// 学习总结表
export const learningSummaries = pgTable(
  "learning_summaries",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    student_id: varchar("student_id", { length: 36 }).notNull().references(() => students.id, { onDelete: "cascade" }),
    session_id: varchar("session_id", { length: 64 }).notNull(),
    strengths: text("strengths").notNull().default(""),
    weaknesses: text("weaknesses").notNull().default(""),
    suggestions: text("suggestions").notNull().default(""),
    // 新增：课堂表现结构化数据
    question_total: integer("question_total").notNull().default(0),
    question_correct: integer("question_correct").notNull().default(0),
    discussion_summary: text("discussion_summary"),
    overall_summary: text("overall_summary"),
    practice_evaluation: text("practice_evaluation"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("learning_summaries_student_id_idx").on(table.student_id),
    index("learning_summaries_session_id_idx").on(table.session_id),
  ]
);

const { createInsertSchema: createCoercedInsertSchema } = createSchemaFactory({ coerce: { date: true } });

export const insertStudentSchema = createCoercedInsertSchema(students).pick({ name: true, companion_level: true });
export const insertKnowledgePointSchema = createCoercedInsertSchema(knowledgePoints).pick({ title: true, content: true });
export const insertQuestionSchema = createCoercedInsertSchema(questions).pick({ question_text: true, answer: true, question_type: true, options: true, knowledge_point_id: true });
export const insertGuidanceScriptSchema = createCoercedInsertSchema(guidanceScripts).pick({ title: true, content: true });

export type Student = typeof students.$inferSelect;
export type KnowledgePoint = typeof knowledgePoints.$inferSelect;
export type Question = typeof questions.$inferSelect;
export type GuidanceScript = typeof guidanceScripts.$inferSelect;
export type SessionState = typeof sessionStates.$inferSelect;
export type InteractionRecord = typeof interactionRecords.$inferSelect;
export type AnswerRecord = typeof answerRecords.$inferSelect;
export type LearningSummary = typeof learningSummaries.$inferSelect;
export type SystemSetting = typeof systemSettings.$inferSelect;

// 学伴水平类型
export const COMPANION_LEVELS = {
  normal: "普通水平（与学生水平相当）",
  advanced: "高水平（学有余力）",
} as const;
export type CompanionLevel = keyof typeof COMPANION_LEVELS;

// 会话阶段类型
export const SESSION_PHASES = {
  teaching: "教师引导出题",
  discussing: "学伴讨论",
  answering: "学生答题",
  judging: "教师判题",
  summarizing: "生成总结",
  finished: "已结束",
} as const;
export type SessionPhase = keyof typeof SESSION_PHASES;
