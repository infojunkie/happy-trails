import { createApp } from '../../src/server/app.js';
import { createFixtureContext } from './library.js';

const port = Number.parseInt(process.env.UI_PORT ?? '4173', 10);
const context = await createFixtureContext({
  artworkFiles: new Map([
    ['covers/abbey.jpg', Buffer.from('%PDF-1.4\nfixture artwork\n')],
  ]),
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
      comments: null,
      cover_path: '',
      title_track: false,
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
      comments: null,
      cover_path: '',
      title_track: false,
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
      comments: null,
      cover_path: '',
      title_track: false,
    },
    // Enough genres and regions to exercise the +N expansion in album cards,
    // the album dialog, and track rows.
    {
      album: 'World Sampler',
      artist: 'Various Artists',
      year: 2020,
      track_count: 1,
      duration: 240,
      latest: '2024-06-01T10:00:00',
      genres:
        'Folk,Pop,Jazz,Blues,Soul,Funk,Rock,Reggae,Brazil,France,Spain,Italy,Germany,Portugal,Japan,USA',
      track_artists: ['Various Artists'],
      composers: [],
      comments: null,
      cover_path: '',
      title_track: false,
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
