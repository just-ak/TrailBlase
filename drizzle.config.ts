import { defineConfig } from 'drizzle-kit';

/**
 * Migrations are generated into src/main/db/migrations and applied at runtime by
 * src/main/db/migrate.ts. `dbCredentials.url` is only used by drizzle-kit for
 * introspection commands; the application resolves its own path at runtime in
 * the macOS application support directory.
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/main/db/schema.ts',
  out: './src/main/db/migrations',
  dbCredentials: {
    url: './.drizzle/introspect.db',
  },
  strict: true,
  verbose: true,
});
