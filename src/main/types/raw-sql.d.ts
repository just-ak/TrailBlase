/**
 * Migration SQL is imported with Vite's `?raw` suffix so the bundler inlines it
 * into the main-process bundle. That keeps the drizzle-kit-generated `.sql`
 * files as the source of truth while removing any runtime dependency on those
 * files existing on disk — which matters once the app is packed into an asar.
 */
declare module '*.sql?raw' {
  const content: string;
  export default content;
}
