import { integer, index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const trainingRecords = sqliteTable(
  "training_records",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    ownerUserId: text("owner_user_id").notNull(),
    recordId: text("record_id").notNull(),
    localDate: text("local_date").notNull(),
    completedAt: text("completed_at").notNull(),
    payloadJson: text("payload_json").notNull(),
  },
  (table) => [
    uniqueIndex("training_records_owner_record_unique").on(table.ownerUserId, table.recordId),
    index("training_records_owner_order_idx").on(
      table.ownerUserId,
      table.localDate,
      table.completedAt,
      table.recordId,
    ),
    index("training_records_owner_seq_idx").on(table.ownerUserId, table.seq),
  ],
);

export const trainingSessions = sqliteTable(
  "training_sessions",
  {
    sessionHash: text("session_hash").primaryKey(),
    ownerUserId: text("owner_user_id").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    index("training_sessions_owner_idx").on(table.ownerUserId),
    index("training_sessions_expiry_idx").on(table.expiresAt),
  ],
);

export const userWorkspace = sqliteTable("user_workspace", {
  ownerUserId: text("owner_user_id").primaryKey(),
  revision: integer("revision").notNull().default(0),
  draftJson: text("draft_json"),
  customExercisesJson: text("custom_exercises_json").notNull().default("[]"),
  updatedAt: text("updated_at").notNull(),
});

export const accountSecrets = sqliteTable("account_secrets", {
  ownerUserId: text("owner_user_id").primaryKey(),
  cursorSecret: text("cursor_secret").notNull(),
});
