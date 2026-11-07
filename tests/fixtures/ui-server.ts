import { createApp } from '../../src/server/app.js';
import { createFixtureContext } from './library.js';

const port = Number.parseInt(process.env.UI_PORT ?? '4173', 10);
const context = await createFixtureContext({
  // Ensure both facet-search inputs are visible in the UI (more than 12 tags).
  extraRows: [
    {
      album: 'Kraftwerk',
      artist: 'Kraftwerk',
      year: 1974,
      track_count: 5,
      duration: 1900,
      latest: '2014-01-01T10:00:00',
      genres: 'Electronic,Krautrock,Germany',
      track_artists: ['Kraftwerk'],
      composers: ['Ralf Hütter, Florian Schneider'],
      cover_path: '',
    },
    {
      album: 'Madredeus',
      artist: 'Madredeus',
      year: 1990,
      track_count: 10,
      duration: 2600,
      latest: '2013-01-01T10:00:00',
      genres: 'Folk,Fado,Portugal',
      track_artists: ['Madredeus'],
      composers: ['Pedro Ayres Magalhães'],
      cover_path: '',
    },
    {
      album: 'Paolo Conte',
      artist: 'Paolo Conte',
      year: 1987,
      track_count: 6,
      duration: 2100,
      latest: '2012-01-01T10:00:00',
      genres: 'Jazz,Chanson,Italy',
      track_artists: ['Paolo Conte'],
      composers: ['Paolo Conte'],
      cover_path: '',
    },
  ],
});
const server = createApp(context.dependencies).listen(port, '127.0.0.1', () => {
  console.log(`[ui-fixture] listening on http://127.0.0.1:${port}`);
});

let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => {
    context.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
