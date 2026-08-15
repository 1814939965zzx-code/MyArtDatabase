import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const projectDimensions = sqliteTable(
  "project_dimensions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    leftLabel: text("left_label").notNull(),
    rightLabel: text("right_label").notNull(),
    sortOrder: integer("sort_order").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("project_dimensions_project_order_unique").on(
      table.projectId,
      table.sortOrder,
    ),
  ],
);

export const assets = sqliteTable("assets", {
  id: text("id").primaryKey(),
  externalId: text("external_id"),
  name: text("name").notNull(),
  fileName: text("file_name").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  storageKey: text("storage_key"),
  thumbnailKey: text("thumbnail_key"),
  sha256: text("sha256"),
  fileSize: integer("file_size").notNull().default(0),
  width: integer("width").notNull().default(0),
  height: integer("height").notNull().default(0),
  mimeType: text("mime_type").notNull().default("image/jpeg"),
  tags: text("tags").notNull().default(""),
  description: text("description").notNull().default(""),
  notes: text("notes").notNull().default(""),
  sourceUrl: text("source_url").notNull().default(""),
  deletedAt: text("deleted_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("assets_sha256_idx").on(table.sha256)]);

export const projectAssets = sqliteTable(
  "project_assets",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.assetId] })],
);

export const assetDimensionValues = sqliteTable(
  "asset_dimension_values",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    dimensionId: text("dimension_id")
      .notNull()
      .references(() => projectDimensions.id, { onDelete: "cascade" }),
    value: integer("value").notNull().default(500),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.assetId, table.dimensionId] }),
    check(
      "asset_dimension_values_range_check",
      sql`${table.value} >= 0 AND ${table.value} <= 1000`,
    ),
  ],
);

export const canvases = sqliteTable("canvases", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  revision: integer("revision").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const canvasItems = sqliteTable(
  "canvas_items",
  {
    id: text("id").primaryKey(),
    canvasId: text("canvas_id")
      .notNull()
      .references(() => canvases.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    x: integer("x").notNull(),
    y: integer("y").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    zIndex: integer("z_index").notNull().default(0),
    rotation: integer("rotation").notNull().default(0),
  },
  (table) => [index("canvas_items_canvas_idx").on(table.canvasId)],
);
