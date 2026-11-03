-- public.music definition

-- Drop table

-- DROP TABLE public.music;

CREATE TABLE public.music (
	id serial4 NOT NULL,
	"path" text NOT NULL,
	title text NOT NULL,
	filesize int8 DEFAULT 0 NOT NULL,
	album text NULL,
	artist text NULL,
	album_artist text NULL,
	composer text NULL,
	"comment" text NULL,
	"year" int4 NULL,
	genre varchar(128) NULL,
	frequency int4 NULL,
	bitrate int4 NULL,
	duration int4 NULL,
	channel int4 NULL,
	track int4 NULL,
	disc int4 NULL,
	covercount int4 NULL,
	"date" timestamp NULL,
	mdate timestamp NULL,
	fs_uuid text NULL,
	fs_online bool DEFAULT true NULL,
	CONSTRAINT music_pkey PRIMARY KEY (id)
);
CREATE INDEX music_album_artist_idx ON public.music USING btree (album_artist);
CREATE INDEX music_album_idx ON public.music USING btree (album);
CREATE INDEX music_artist_idx ON public.music USING btree (artist);
CREATE INDEX music_composer_idx ON public.music USING btree (composer);
CREATE INDEX music_date_idx ON public.music USING btree (date);
CREATE INDEX music_disc_idx ON public.music USING btree (disc);
CREATE INDEX music_genre_idx ON public.music USING btree (genre);
CREATE INDEX music_mdate_idx ON public.music USING btree (mdate);
CREATE UNIQUE INDEX music_path_idx ON public.music USING btree (path);
CREATE INDEX music_title_idx ON public.music USING btree (title);
CREATE INDEX music_track_idx ON public.music USING btree (track);
CREATE INDEX music_year_idx ON public.music USING btree (year);