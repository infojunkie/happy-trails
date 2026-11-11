--
-- PostgreSQL database dump
--

\restrict UvPt1LcCLPJ5uCvbB6yXtLVKbclURL4qNu223wS6fuhjj08l6mh9GTduTudnVDB

-- Dumped from database version 11.11
-- Dumped by pg_dump version 14.24 (Ubuntu 14.24-0ubuntu0.22.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = off;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET escape_string_warning = off;
SET row_security = off;

--
-- Name: en_US_synology; Type: COLLATION; Schema: public; Owner: postgres
--

CREATE COLLATION public."en_US_synology" (provider = libc, locale = 'en_US.utf8');


ALTER COLLATION public."en_US_synology" OWNER TO postgres;

SET default_tablespace = '';

--
-- Name: album_track; Type: TABLE; Schema: public; Owner: MediaIndex
--

CREATE TABLE public.album_track (
    track integer NOT NULL,
    album text NOT NULL,
    album_sort text NOT NULL,
    album_search text NOT NULL,
    album_artist text NOT NULL,
    album_artist_sort text,
    album_artist_search text,
    from_album_artist boolean DEFAULT false
);


ALTER TABLE public.album_track OWNER TO "MediaIndex";

--
-- Name: artist_track; Type: TABLE; Schema: public; Owner: MediaIndex
--

CREATE TABLE public.artist_track (
    track integer NOT NULL,
    artist text NOT NULL,
    artist_sort text NOT NULL,
    artist_search text NOT NULL,
    has_album_artist boolean DEFAULT false
);


ALTER TABLE public.artist_track OWNER TO "MediaIndex";

--
-- Name: composer_track; Type: TABLE; Schema: public; Owner: MediaIndex
--

CREATE TABLE public.composer_track (
    track integer NOT NULL,
    composer text NOT NULL,
    composer_sort text NOT NULL,
    composer_search text NOT NULL
);


ALTER TABLE public.composer_track OWNER TO "MediaIndex";

--
-- Name: config; Type: TABLE; Schema: public; Owner: MediaIndex
--

CREATE TABLE public.config (
    key text NOT NULL,
    value text NOT NULL
);


ALTER TABLE public.config OWNER TO "MediaIndex";

--
-- Name: directory; Type: TABLE; Schema: public; Owner: MediaIndex
--

CREATE TABLE public.directory (
    id integer NOT NULL,
    path text NOT NULL,
    title text,
    date timestamp without time zone,
    mdate timestamp without time zone,
    fs_uuid text,
    fs_online boolean DEFAULT true
);


ALTER TABLE public.directory OWNER TO "MediaIndex";

--
-- Name: directory_id_seq; Type: SEQUENCE; Schema: public; Owner: MediaIndex
--

CREATE SEQUENCE public.directory_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.directory_id_seq OWNER TO "MediaIndex";

--
-- Name: directory_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: MediaIndex
--

ALTER SEQUENCE public.directory_id_seq OWNED BY public.directory.id;


--
-- Name: genre_track; Type: TABLE; Schema: public; Owner: MediaIndex
--

CREATE TABLE public.genre_track (
    track integer NOT NULL,
    genre text NOT NULL,
    genre_sort text NOT NULL,
    genre_search text NOT NULL
);


ALTER TABLE public.genre_track OWNER TO "MediaIndex";

--
-- Name: music; Type: TABLE; Schema: public; Owner: MediaIndex
--

CREATE TABLE public.music (
    id integer NOT NULL,
    path text NOT NULL,
    title text NOT NULL,
    filesize bigint DEFAULT 0 NOT NULL,
    album text,
    artist text,
    album_artist text,
    composer text,
    comment text,
    year integer,
    genre character varying(128),
    frequency integer,
    bitrate integer,
    duration integer,
    channel integer,
    track integer,
    disc integer,
    covercount integer,
    date timestamp without time zone,
    mdate timestamp without time zone,
    fs_uuid text,
    fs_online boolean DEFAULT true
);


ALTER TABLE public.music OWNER TO "MediaIndex";

--
-- Name: music_id_seq; Type: SEQUENCE; Schema: public; Owner: MediaIndex
--

CREATE SEQUENCE public.music_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.music_id_seq OWNER TO "MediaIndex";

--
-- Name: music_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: MediaIndex
--

ALTER SEQUENCE public.music_id_seq OWNED BY public.music.id;


--
-- Name: personal_directory; Type: TABLE; Schema: public; Owner: MediaIndex
--

CREATE TABLE public.personal_directory (
    userid bigint NOT NULL,
    id integer NOT NULL,
    path text NOT NULL,
    title text,
    date timestamp without time zone,
    mdate timestamp without time zone,
    fs_uuid text,
    fs_online boolean DEFAULT true,
    updated character(1) DEFAULT '1'::bpchar
);


ALTER TABLE public.personal_directory OWNER TO "MediaIndex";

--
-- Name: personal_directory_id_seq; Type: SEQUENCE; Schema: public; Owner: MediaIndex
--

CREATE SEQUENCE public.personal_directory_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.personal_directory_id_seq OWNER TO "MediaIndex";

--
-- Name: personal_directory_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: MediaIndex
--

ALTER SEQUENCE public.personal_directory_id_seq OWNED BY public.personal_directory.id;


--
-- Name: personal_music; Type: TABLE; Schema: public; Owner: MediaIndex
--

CREATE TABLE public.personal_music (
    userid bigint NOT NULL,
    id integer NOT NULL,
    path text NOT NULL,
    title text NOT NULL,
    filesize bigint DEFAULT 0 NOT NULL,
    album text,
    artist text,
    album_artist text,
    composer text,
    comment text,
    year integer,
    genre character varying(128),
    frequency integer,
    bitrate integer,
    duration integer,
    channel integer,
    track integer,
    disc integer,
    covercount integer,
    date timestamp without time zone,
    mdate timestamp without time zone,
    fs_uuid text,
    fs_online boolean DEFAULT true,
    updated character(1) DEFAULT '1'::bpchar,
    star integer DEFAULT 0 NOT NULL
);


ALTER TABLE public.personal_music OWNER TO "MediaIndex";

--
-- Name: personal_music_id_seq; Type: SEQUENCE; Schema: public; Owner: MediaIndex
--

CREATE SEQUENCE public.personal_music_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.personal_music_id_seq OWNER TO "MediaIndex";

--
-- Name: personal_music_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: MediaIndex
--

ALTER SEQUENCE public.personal_music_id_seq OWNED BY public.personal_music.id;


--
-- Name: personal_playlist; Type: TABLE; Schema: public; Owner: MediaIndex
--

CREATE TABLE public.personal_playlist (
    userid bigint NOT NULL,
    id integer NOT NULL,
    path text NOT NULL,
    title text NOT NULL,
    filesize bigint DEFAULT 0 NOT NULL,
    album text,
    song_count integer DEFAULT 0 NOT NULL,
    date timestamp without time zone,
    mdate timestamp without time zone,
    fs_uuid text,
    fs_online boolean DEFAULT true,
    updated character(1) DEFAULT '1'::bpchar
);


ALTER TABLE public.personal_playlist OWNER TO "MediaIndex";

--
-- Name: personal_playlist_id_seq; Type: SEQUENCE; Schema: public; Owner: MediaIndex
--

CREATE SEQUENCE public.personal_playlist_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.personal_playlist_id_seq OWNER TO "MediaIndex";

--
-- Name: personal_playlist_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: MediaIndex
--

ALTER SEQUENCE public.personal_playlist_id_seq OWNED BY public.personal_playlist.id;


--
-- Name: photo; Type: TABLE; Schema: public; Owner: MediaIndex
--

CREATE TABLE public.photo (
    id integer NOT NULL,
    path text NOT NULL,
    title text NOT NULL,
    filesize bigint DEFAULT 0 NOT NULL,
    album text,
    resolutionx integer,
    resolutiony integer,
    camera_make character varying(100),
    camera_model character varying(100),
    exposure character varying(20),
    aperture character varying(20),
    iso integer,
    date timestamp without time zone,
    timetaken timestamp without time zone,
    mdate timestamp without time zone,
    fs_uuid text,
    fs_online boolean DEFAULT true
);


ALTER TABLE public.photo OWNER TO "MediaIndex";

--
-- Name: photo_id_seq; Type: SEQUENCE; Schema: public; Owner: MediaIndex
--

CREATE SEQUENCE public.photo_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.photo_id_seq OWNER TO "MediaIndex";

--
-- Name: photo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: MediaIndex
--

ALTER SEQUENCE public.photo_id_seq OWNED BY public.photo.id;


--
-- Name: pin; Type: TABLE; Schema: public; Owner: MediaIndex
--

CREATE TABLE public.pin (
    id character varying(20) NOT NULL,
    user_id integer NOT NULL,
    type character varying(64) NOT NULL,
    name text DEFAULT ''::text,
    criteria text DEFAULT ''::text,
    sort_key integer NOT NULL
);


ALTER TABLE public.pin OWNER TO "MediaIndex";

--
-- Name: pin_id_seq; Type: SEQUENCE; Schema: public; Owner: MediaIndex
--

CREATE SEQUENCE public.pin_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.pin_id_seq OWNER TO "MediaIndex";

--
-- Name: pin_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: MediaIndex
--

ALTER SEQUENCE public.pin_id_seq OWNED BY public.pin.id;


--
-- Name: playcount_track; Type: TABLE; Schema: public; Owner: MediaIndex
--

CREATE TABLE public.playcount_track (
    userid bigint NOT NULL,
    track integer NOT NULL,
    count bigint DEFAULT 0,
    mdate timestamp without time zone
);


ALTER TABLE public.playcount_track OWNER TO "MediaIndex";

--
-- Name: playlist; Type: TABLE; Schema: public; Owner: MediaIndex
--

CREATE TABLE public.playlist (
    id integer NOT NULL,
    path text NOT NULL,
    title text NOT NULL,
    filesize bigint DEFAULT 0 NOT NULL,
    album text,
    song_count integer DEFAULT 0 NOT NULL,
    date timestamp without time zone,
    mdate timestamp without time zone,
    fs_uuid text,
    fs_online boolean DEFAULT true
);


ALTER TABLE public.playlist OWNER TO "MediaIndex";

--
-- Name: playlist_id_seq; Type: SEQUENCE; Schema: public; Owner: MediaIndex
--

CREATE SEQUENCE public.playlist_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.playlist_id_seq OWNER TO "MediaIndex";

--
-- Name: playlist_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: MediaIndex
--

ALTER SEQUENCE public.playlist_id_seq OWNED BY public.playlist.id;


--
-- Name: playlist_sharing; Type: TABLE; Schema: public; Owner: MediaIndex
--

CREATE TABLE public.playlist_sharing (
    id character varying(20) NOT NULL,
    user_id integer NOT NULL,
    user_name text DEFAULT ''::text,
    playlist_id text NOT NULL,
    path text DEFAULT ''::text NOT NULL,
    avail_date date DEFAULT '1970-01-01'::date NOT NULL,
    exp_date date DEFAULT '1970-01-01'::date NOT NULL,
    status character varying(32) DEFAULT ''::character varying,
    updated character(1) DEFAULT '1'::bpchar
);


ALTER TABLE public.playlist_sharing OWNER TO "MediaIndex";

--
-- Name: rating; Type: TABLE; Schema: public; Owner: MediaIndex
--

CREATE TABLE public.rating (
    id integer NOT NULL,
    userid integer NOT NULL,
    musicid integer,
    star integer DEFAULT 0 NOT NULL,
    updated character(1) DEFAULT '1'::bpchar,
    virtual_musicid integer
);


ALTER TABLE public.rating OWNER TO "MediaIndex";

--
-- Name: rating_id_seq; Type: SEQUENCE; Schema: public; Owner: MediaIndex
--

CREATE SEQUENCE public.rating_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.rating_id_seq OWNER TO "MediaIndex";

--
-- Name: rating_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: MediaIndex
--

ALTER SEQUENCE public.rating_id_seq OWNED BY public.rating.id;


--
-- Name: rating_track; Type: TABLE; Schema: public; Owner: MediaIndex
--

CREATE TABLE public.rating_track (
    userid bigint NOT NULL,
    track integer NOT NULL,
    star integer DEFAULT 0 NOT NULL
);


ALTER TABLE public.rating_track OWNER TO "MediaIndex";

--
-- Name: replaygain_track; Type: TABLE; Schema: public; Owner: MediaIndex
--

CREATE TABLE public.replaygain_track (
    track integer NOT NULL,
    rg_track_gain real,
    rg_track_peak real,
    rg_album_gain real,
    rg_album_peak real
);


ALTER TABLE public.replaygain_track OWNER TO "MediaIndex";

--
-- Name: track; Type: TABLE; Schema: public; Owner: MediaIndex
--

CREATE TABLE public.track (
    userid bigint,
    id integer NOT NULL,
    path text NOT NULL,
    title text NOT NULL,
    title_sort text NOT NULL,
    title_search text NOT NULL,
    filesize bigint DEFAULT 0,
    year integer,
    frequency integer,
    channel integer,
    bitrate integer,
    duration real,
    comment text,
    track integer,
    disc integer,
    container text,
    codec text,
    is_virtual boolean DEFAULT false,
    has_virtual boolean DEFAULT false,
    covercount integer,
    date timestamp without time zone,
    mdate timestamp without time zone,
    agg_genre text,
    agg_genre_sort text,
    agg_genre_search text
);


ALTER TABLE public.track OWNER TO "MediaIndex";

--
-- Name: track_id_seq; Type: SEQUENCE; Schema: public; Owner: MediaIndex
--

CREATE SEQUENCE public.track_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.track_id_seq OWNER TO "MediaIndex";

--
-- Name: track_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: MediaIndex
--

ALTER SEQUENCE public.track_id_seq OWNED BY public.track.id;


--
-- Name: video; Type: TABLE; Schema: public; Owner: MediaIndex
--

CREATE TABLE public.video (
    id integer NOT NULL,
    path text NOT NULL,
    title text NOT NULL,
    filesize bigint DEFAULT 0 NOT NULL,
    album text,
    container_type text NOT NULL,
    video_codec text,
    frame_bitrate integer,
    frame_rate_num integer,
    frame_rate_den integer,
    video_bitrate integer,
    video_profile integer,
    video_level integer,
    resolutionx integer,
    resolutiony integer,
    audio_codec text,
    audio_bitrate integer,
    frequency integer,
    channel integer,
    duration integer,
    date timestamp without time zone,
    mdate timestamp without time zone,
    fs_uuid text,
    fs_online boolean DEFAULT true
);


ALTER TABLE public.video OWNER TO "MediaIndex";

--
-- Name: video_convert; Type: TABLE; Schema: public; Owner: MediaIndex
--

CREATE TABLE public.video_convert (
    video_path text NOT NULL,
    convert_file_path text NOT NULL,
    resolutionx integer,
    resolutiony integer,
    container_type text NOT NULL,
    video_bitrate integer,
    vcodec text,
    video_profile integer,
    video_level integer,
    acodec text,
    audio_bitrate integer,
    audio_frequency integer,
    audio_channel integer,
    convert_type text NOT NULL,
    fs_online boolean DEFAULT true
);


ALTER TABLE public.video_convert OWNER TO "MediaIndex";

--
-- Name: video_id_seq; Type: SEQUENCE; Schema: public; Owner: MediaIndex
--

CREATE SEQUENCE public.video_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.video_id_seq OWNER TO "MediaIndex";

--
-- Name: video_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: MediaIndex
--

ALTER SEQUENCE public.video_id_seq OWNED BY public.video.id;


--
-- Name: virtual_info_track; Type: TABLE; Schema: public; Owner: MediaIndex
--

CREATE TABLE public.virtual_info_track (
    track integer NOT NULL,
    audio_offset text DEFAULT ''::text NOT NULL,
    cue_sheet_path text DEFAULT ''::text NOT NULL
);


ALTER TABLE public.virtual_info_track OWNER TO "MediaIndex";

--
-- Name: virtual_music; Type: TABLE; Schema: public; Owner: MediaIndex
--

CREATE TABLE public.virtual_music (
    id integer NOT NULL,
    path text DEFAULT ''::text NOT NULL,
    title text DEFAULT ''::text,
    album text DEFAULT ''::text,
    artist text DEFAULT ''::text,
    album_artist text DEFAULT ''::text,
    composer text DEFAULT ''::text,
    year integer,
    genre character varying(128),
    comment text NOT NULL,
    duration integer NOT NULL,
    track integer NOT NULL
);


ALTER TABLE public.virtual_music OWNER TO "MediaIndex";

--
-- Name: virtual_music_id_seq; Type: SEQUENCE; Schema: public; Owner: MediaIndex
--

CREATE SEQUENCE public.virtual_music_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.virtual_music_id_seq OWNER TO "MediaIndex";

--
-- Name: virtual_music_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: MediaIndex
--

ALTER SEQUENCE public.virtual_music_id_seq OWNED BY public.virtual_music.id;


--
-- Name: virtual_personal_music; Type: TABLE; Schema: public; Owner: MediaIndex
--

CREATE TABLE public.virtual_personal_music (
    userid integer NOT NULL,
    id integer NOT NULL,
    path text DEFAULT ''::text NOT NULL,
    title text DEFAULT ''::text,
    album text DEFAULT ''::text,
    artist text DEFAULT ''::text,
    album_artist text DEFAULT ''::text,
    composer text DEFAULT ''::text,
    year integer,
    genre character varying(128),
    comment text NOT NULL,
    duration integer NOT NULL,
    track integer NOT NULL,
    star integer DEFAULT 0 NOT NULL
);


ALTER TABLE public.virtual_personal_music OWNER TO "MediaIndex";

--
-- Name: virtual_personal_music_id_seq; Type: SEQUENCE; Schema: public; Owner: MediaIndex
--

CREATE SEQUENCE public.virtual_personal_music_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.virtual_personal_music_id_seq OWNER TO "MediaIndex";

--
-- Name: virtual_personal_music_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: MediaIndex
--

ALTER SEQUENCE public.virtual_personal_music_id_seq OWNED BY public.virtual_personal_music.id;


--
-- Name: voice_search; Type: TABLE; Schema: public; Owner: MediaIndex
--

CREATE TABLE public.voice_search (
    track integer NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    album text DEFAULT ''::text NOT NULL,
    artist text DEFAULT ''::text NOT NULL,
    album_artist text DEFAULT ''::text NOT NULL
);


ALTER TABLE public.voice_search OWNER TO "MediaIndex";

--
-- Name: directory id; Type: DEFAULT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.directory ALTER COLUMN id SET DEFAULT nextval('public.directory_id_seq'::regclass);


--
-- Name: music id; Type: DEFAULT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.music ALTER COLUMN id SET DEFAULT nextval('public.music_id_seq'::regclass);


--
-- Name: personal_directory id; Type: DEFAULT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.personal_directory ALTER COLUMN id SET DEFAULT nextval('public.personal_directory_id_seq'::regclass);


--
-- Name: personal_music id; Type: DEFAULT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.personal_music ALTER COLUMN id SET DEFAULT nextval('public.personal_music_id_seq'::regclass);


--
-- Name: personal_playlist id; Type: DEFAULT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.personal_playlist ALTER COLUMN id SET DEFAULT nextval('public.personal_playlist_id_seq'::regclass);


--
-- Name: photo id; Type: DEFAULT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.photo ALTER COLUMN id SET DEFAULT nextval('public.photo_id_seq'::regclass);


--
-- Name: pin id; Type: DEFAULT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.pin ALTER COLUMN id SET DEFAULT nextval('public.pin_id_seq'::regclass);


--
-- Name: playlist id; Type: DEFAULT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.playlist ALTER COLUMN id SET DEFAULT nextval('public.playlist_id_seq'::regclass);


--
-- Name: rating id; Type: DEFAULT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.rating ALTER COLUMN id SET DEFAULT nextval('public.rating_id_seq'::regclass);


--
-- Name: track id; Type: DEFAULT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.track ALTER COLUMN id SET DEFAULT nextval('public.track_id_seq'::regclass);


--
-- Name: video id; Type: DEFAULT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.video ALTER COLUMN id SET DEFAULT nextval('public.video_id_seq'::regclass);


--
-- Name: virtual_music id; Type: DEFAULT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.virtual_music ALTER COLUMN id SET DEFAULT nextval('public.virtual_music_id_seq'::regclass);


--
-- Name: virtual_personal_music id; Type: DEFAULT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.virtual_personal_music ALTER COLUMN id SET DEFAULT nextval('public.virtual_personal_music_id_seq'::regclass);


--
-- Name: album_track album_track_pkey; Type: CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.album_track
    ADD CONSTRAINT album_track_pkey PRIMARY KEY (track, album, album_artist);


--
-- Name: artist_track artist_track_pkey; Type: CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.artist_track
    ADD CONSTRAINT artist_track_pkey PRIMARY KEY (track, artist);


--
-- Name: pin audio_pin_pkey; Type: CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.pin
    ADD CONSTRAINT audio_pin_pkey PRIMARY KEY (id);


--
-- Name: pin audio_pin_ukey; Type: CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.pin
    ADD CONSTRAINT audio_pin_ukey UNIQUE (user_id, type, criteria);


--
-- Name: composer_track composer_track_pkey; Type: CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.composer_track
    ADD CONSTRAINT composer_track_pkey PRIMARY KEY (track, composer);


--
-- Name: config config_key_primary; Type: CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.config
    ADD CONSTRAINT config_key_primary PRIMARY KEY (key);


--
-- Name: directory directory_path_key; Type: CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.directory
    ADD CONSTRAINT directory_path_key UNIQUE (path);


--
-- Name: directory directory_pkey; Type: CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.directory
    ADD CONSTRAINT directory_pkey PRIMARY KEY (id);


--
-- Name: genre_track genre_track_pkey; Type: CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.genre_track
    ADD CONSTRAINT genre_track_pkey PRIMARY KEY (track, genre);


--
-- Name: music music_pkey; Type: CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.music
    ADD CONSTRAINT music_pkey PRIMARY KEY (id);


--
-- Name: personal_directory personal_directory_path_key; Type: CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.personal_directory
    ADD CONSTRAINT personal_directory_path_key UNIQUE (path);


--
-- Name: personal_directory personal_directory_pkey; Type: CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.personal_directory
    ADD CONSTRAINT personal_directory_pkey PRIMARY KEY (id);


--
-- Name: personal_music personal_music_pkey; Type: CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.personal_music
    ADD CONSTRAINT personal_music_pkey PRIMARY KEY (id);


--
-- Name: personal_playlist personal_playlist_pkey; Type: CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.personal_playlist
    ADD CONSTRAINT personal_playlist_pkey PRIMARY KEY (id);


--
-- Name: photo photo_pkey; Type: CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.photo
    ADD CONSTRAINT photo_pkey PRIMARY KEY (id);


--
-- Name: playcount_track playcount_track_pkey; Type: CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.playcount_track
    ADD CONSTRAINT playcount_track_pkey PRIMARY KEY (userid, track);


--
-- Name: playlist playlist_pkey; Type: CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.playlist
    ADD CONSTRAINT playlist_pkey PRIMARY KEY (id);


--
-- Name: playlist_sharing playlist_sharing_pkey; Type: CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.playlist_sharing
    ADD CONSTRAINT playlist_sharing_pkey PRIMARY KEY (id);


--
-- Name: playlist_sharing playlist_sharing_ukey; Type: CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.playlist_sharing
    ADD CONSTRAINT playlist_sharing_ukey UNIQUE (user_id, playlist_id);


--
-- Name: rating rating_pkey; Type: CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.rating
    ADD CONSTRAINT rating_pkey PRIMARY KEY (id);


--
-- Name: rating_track rating_track_pkey; Type: CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.rating_track
    ADD CONSTRAINT rating_track_pkey PRIMARY KEY (userid, track);


--
-- Name: rating rating_ukey; Type: CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.rating
    ADD CONSTRAINT rating_ukey UNIQUE (userid, musicid, virtual_musicid);


--
-- Name: replaygain_track replaygain_track_pkey; Type: CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.replaygain_track
    ADD CONSTRAINT replaygain_track_pkey PRIMARY KEY (track);


--
-- Name: track track_pkey; Type: CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.track
    ADD CONSTRAINT track_pkey PRIMARY KEY (id);


--
-- Name: video_convert video_convert_pkey; Type: CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.video_convert
    ADD CONSTRAINT video_convert_pkey PRIMARY KEY (convert_file_path);


--
-- Name: video video_pkey; Type: CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.video
    ADD CONSTRAINT video_pkey PRIMARY KEY (id);


--
-- Name: virtual_info_track virtual_info_track_pkey; Type: CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.virtual_info_track
    ADD CONSTRAINT virtual_info_track_pkey PRIMARY KEY (track);


--
-- Name: virtual_music virtual_music_pkey; Type: CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.virtual_music
    ADD CONSTRAINT virtual_music_pkey PRIMARY KEY (id);


--
-- Name: virtual_music virtual_music_ukey; Type: CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.virtual_music
    ADD CONSTRAINT virtual_music_ukey UNIQUE (comment, track);


--
-- Name: virtual_personal_music virtual_personal_music_pkey; Type: CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.virtual_personal_music
    ADD CONSTRAINT virtual_personal_music_pkey PRIMARY KEY (id);


--
-- Name: virtual_personal_music virtual_personal_music_ukey; Type: CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.virtual_personal_music
    ADD CONSTRAINT virtual_personal_music_ukey UNIQUE (comment, track);


--
-- Name: voice_search voice_search_pkey; Type: CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.voice_search
    ADD CONSTRAINT voice_search_pkey PRIMARY KEY (track);


--
-- Name: album_track_album_artist_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX album_track_album_artist_idx ON public.album_track USING btree (album_artist);


--
-- Name: album_track_album_artist_search_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX album_track_album_artist_search_idx ON public.album_track USING btree (album_artist_search);


--
-- Name: album_track_album_artist_sort_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX album_track_album_artist_sort_idx ON public.album_track USING btree (album_artist_sort);


--
-- Name: album_track_album_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX album_track_album_idx ON public.album_track USING btree (album);


--
-- Name: album_track_album_search_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX album_track_album_search_idx ON public.album_track USING btree (album_search);


--
-- Name: album_track_album_sort_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX album_track_album_sort_idx ON public.album_track USING btree (album_sort);


--
-- Name: album_track_track_album_album_artist_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE UNIQUE INDEX album_track_track_album_album_artist_idx ON public.album_track USING btree (track, album, album_artist);


--
-- Name: album_track_track_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX album_track_track_idx ON public.album_track USING btree (track);


--
-- Name: artist_track_artist_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX artist_track_artist_idx ON public.artist_track USING btree (artist);


--
-- Name: artist_track_artist_search_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX artist_track_artist_search_idx ON public.artist_track USING btree (artist_search);


--
-- Name: artist_track_artist_sort_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX artist_track_artist_sort_idx ON public.artist_track USING btree (artist_sort);


--
-- Name: artist_track_track_artist_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE UNIQUE INDEX artist_track_track_artist_idx ON public.artist_track USING btree (track, artist);


--
-- Name: artist_track_track_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX artist_track_track_idx ON public.artist_track USING btree (track);


--
-- Name: composer_track_composer_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX composer_track_composer_idx ON public.composer_track USING btree (composer);


--
-- Name: composer_track_composer_search_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX composer_track_composer_search_idx ON public.composer_track USING btree (composer_search);


--
-- Name: composer_track_composer_sort_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX composer_track_composer_sort_idx ON public.composer_track USING btree (composer_sort);


--
-- Name: composer_track_track_composer_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE UNIQUE INDEX composer_track_track_composer_idx ON public.composer_track USING btree (track, composer);


--
-- Name: composer_track_track_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX composer_track_track_idx ON public.composer_track USING btree (track);


--
-- Name: directory_path_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE UNIQUE INDEX directory_path_idx ON public.directory USING btree (path);


--
-- Name: genre_track_genre_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX genre_track_genre_idx ON public.genre_track USING btree (genre);


--
-- Name: genre_track_genre_search_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX genre_track_genre_search_idx ON public.genre_track USING btree (genre_search);


--
-- Name: genre_track_genre_sort_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX genre_track_genre_sort_idx ON public.genre_track USING btree (genre_sort);


--
-- Name: genre_track_track_genre_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE UNIQUE INDEX genre_track_track_genre_idx ON public.genre_track USING btree (track, genre);


--
-- Name: genre_track_track_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX genre_track_track_idx ON public.genre_track USING btree (track);


--
-- Name: music_album_artist_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX music_album_artist_idx ON public.music USING btree (album_artist);


--
-- Name: music_album_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX music_album_idx ON public.music USING btree (album);


--
-- Name: music_artist_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX music_artist_idx ON public.music USING btree (artist);


--
-- Name: music_composer_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX music_composer_idx ON public.music USING btree (composer);


--
-- Name: music_date_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX music_date_idx ON public.music USING btree (date);


--
-- Name: music_disc_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX music_disc_idx ON public.music USING btree (disc);


--
-- Name: music_genre_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX music_genre_idx ON public.music USING btree (genre);


--
-- Name: music_mdate_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX music_mdate_idx ON public.music USING btree (mdate);


--
-- Name: music_path_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE UNIQUE INDEX music_path_idx ON public.music USING btree (path);


--
-- Name: music_title_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX music_title_idx ON public.music USING btree (title);


--
-- Name: music_track_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX music_track_idx ON public.music USING btree (track);


--
-- Name: music_year_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX music_year_idx ON public.music USING btree (year);


--
-- Name: personal_directory_path_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE UNIQUE INDEX personal_directory_path_idx ON public.personal_directory USING btree (path);


--
-- Name: personal_music_album_artist_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX personal_music_album_artist_idx ON public.personal_music USING btree (album_artist);


--
-- Name: personal_music_album_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX personal_music_album_idx ON public.personal_music USING btree (album);


--
-- Name: personal_music_artist_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX personal_music_artist_idx ON public.personal_music USING btree (artist);


--
-- Name: personal_music_composer_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX personal_music_composer_idx ON public.personal_music USING btree (composer);


--
-- Name: personal_music_date_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX personal_music_date_idx ON public.personal_music USING btree (date);


--
-- Name: personal_music_disc_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX personal_music_disc_idx ON public.personal_music USING btree (disc);


--
-- Name: personal_music_genre_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX personal_music_genre_idx ON public.personal_music USING btree (genre);


--
-- Name: personal_music_mdate_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX personal_music_mdate_idx ON public.personal_music USING btree (mdate);


--
-- Name: personal_music_path_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE UNIQUE INDEX personal_music_path_idx ON public.personal_music USING btree (path);


--
-- Name: personal_music_title_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX personal_music_title_idx ON public.personal_music USING btree (title);


--
-- Name: personal_music_track_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX personal_music_track_idx ON public.personal_music USING btree (track);


--
-- Name: personal_music_year_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX personal_music_year_idx ON public.personal_music USING btree (year);


--
-- Name: personal_playlist_path_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE UNIQUE INDEX personal_playlist_path_idx ON public.personal_playlist USING btree (path);


--
-- Name: photo_date_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX photo_date_idx ON public.photo USING btree (date);


--
-- Name: photo_mdate_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX photo_mdate_idx ON public.photo USING btree (mdate);


--
-- Name: photo_path_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE UNIQUE INDEX photo_path_idx ON public.photo USING btree (path);


--
-- Name: photo_timetaken_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX photo_timetaken_idx ON public.photo USING btree (timetaken);


--
-- Name: photo_title_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX photo_title_idx ON public.photo USING btree (title);


--
-- Name: playcount_track_count_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX playcount_track_count_idx ON public.playcount_track USING btree (count);


--
-- Name: playcount_track_mdate_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX playcount_track_mdate_idx ON public.playcount_track USING btree (mdate);


--
-- Name: playcount_track_track_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX playcount_track_track_idx ON public.playcount_track USING btree (track);


--
-- Name: playcount_track_userid_track_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE UNIQUE INDEX playcount_track_userid_track_idx ON public.playcount_track USING btree (userid, track);


--
-- Name: playlist_path_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE UNIQUE INDEX playlist_path_idx ON public.playlist USING btree (path);


--
-- Name: rating_track_star_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX rating_track_star_idx ON public.rating_track USING btree (star);


--
-- Name: rating_track_track_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX rating_track_track_idx ON public.rating_track USING btree (track);


--
-- Name: rating_track_userid_track_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE UNIQUE INDEX rating_track_userid_track_idx ON public.rating_track USING btree (userid, track);


--
-- Name: replaygain_track_track_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE UNIQUE INDEX replaygain_track_track_idx ON public.replaygain_track USING btree (track);


--
-- Name: track_agg_genre_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX track_agg_genre_idx ON public.track USING btree (agg_genre);


--
-- Name: track_agg_genre_search_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX track_agg_genre_search_idx ON public.track USING btree (agg_genre_search);


--
-- Name: track_agg_genre_sort_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX track_agg_genre_sort_idx ON public.track USING btree (agg_genre_sort);


--
-- Name: track_codec_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX track_codec_idx ON public.track USING btree (codec);


--
-- Name: track_container_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX track_container_idx ON public.track USING btree (container);


--
-- Name: track_date_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX track_date_idx ON public.track USING btree (date);


--
-- Name: track_disc_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX track_disc_idx ON public.track USING btree (disc);


--
-- Name: track_has_virtual_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX track_has_virtual_idx ON public.track USING btree (has_virtual);


--
-- Name: track_is_virtual_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX track_is_virtual_idx ON public.track USING btree (is_virtual);


--
-- Name: track_mdate_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX track_mdate_idx ON public.track USING btree (mdate);


--
-- Name: track_path_is_virtual_track_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE UNIQUE INDEX track_path_is_virtual_track_idx ON public.track USING btree (path, is_virtual, track);


--
-- Name: track_title_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX track_title_idx ON public.track USING btree (title);


--
-- Name: track_title_search_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX track_title_search_idx ON public.track USING btree (title_search);


--
-- Name: track_title_sort_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX track_title_sort_idx ON public.track USING btree (title_sort);


--
-- Name: track_track_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX track_track_idx ON public.track USING btree (track);


--
-- Name: track_year_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX track_year_idx ON public.track USING btree (year);


--
-- Name: video_convert_convert_type_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX video_convert_convert_type_idx ON public.video_convert USING btree (convert_type);


--
-- Name: video_convert_video_path_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX video_convert_video_path_idx ON public.video_convert USING btree (video_path);


--
-- Name: video_date_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX video_date_idx ON public.video USING btree (date);


--
-- Name: video_mdate_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX video_mdate_idx ON public.video USING btree (mdate);


--
-- Name: video_path_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE UNIQUE INDEX video_path_idx ON public.video USING btree (path);


--
-- Name: video_title_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX video_title_idx ON public.video USING btree (title);


--
-- Name: virtual_info_track_audio_offset_cue_sheet_path_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE UNIQUE INDEX virtual_info_track_audio_offset_cue_sheet_path_idx ON public.virtual_info_track USING btree (track);


--
-- Name: virtual_info_track_cue_sheet_path_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX virtual_info_track_cue_sheet_path_idx ON public.virtual_info_track USING btree (cue_sheet_path);


--
-- Name: virtual_info_track_track_idx; Type: INDEX; Schema: public; Owner: MediaIndex
--

CREATE INDEX virtual_info_track_track_idx ON public.virtual_info_track USING btree (track);


--
-- Name: album_track album_track_fkey; Type: FK CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.album_track
    ADD CONSTRAINT album_track_fkey FOREIGN KEY (track) REFERENCES public.track(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: artist_track artist_track_fkey; Type: FK CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.artist_track
    ADD CONSTRAINT artist_track_fkey FOREIGN KEY (track) REFERENCES public.track(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: composer_track composer_track_fkey; Type: FK CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.composer_track
    ADD CONSTRAINT composer_track_fkey FOREIGN KEY (track) REFERENCES public.track(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: genre_track genre_track_fkey; Type: FK CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.genre_track
    ADD CONSTRAINT genre_track_fkey FOREIGN KEY (track) REFERENCES public.track(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: playcount_track playcount_track_fkey; Type: FK CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.playcount_track
    ADD CONSTRAINT playcount_track_fkey FOREIGN KEY (track) REFERENCES public.track(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: rating rating_fkey; Type: FK CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.rating
    ADD CONSTRAINT rating_fkey FOREIGN KEY (musicid) REFERENCES public.music(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: rating_track rating_track_fkey; Type: FK CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.rating_track
    ADD CONSTRAINT rating_track_fkey FOREIGN KEY (track) REFERENCES public.track(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: rating rating_vfkey; Type: FK CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.rating
    ADD CONSTRAINT rating_vfkey FOREIGN KEY (virtual_musicid) REFERENCES public.virtual_music(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: replaygain_track replaygain_track_fkey; Type: FK CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.replaygain_track
    ADD CONSTRAINT replaygain_track_fkey FOREIGN KEY (track) REFERENCES public.track(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: video_convert video_convert_fk1; Type: FK CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.video_convert
    ADD CONSTRAINT video_convert_fk1 FOREIGN KEY (video_path) REFERENCES public.video(path) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: virtual_info_track virtual_info_track_fkey; Type: FK CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.virtual_info_track
    ADD CONSTRAINT virtual_info_track_fkey FOREIGN KEY (track) REFERENCES public.track(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: voice_search voice_search_track_fkey; Type: FK CONSTRAINT; Schema: public; Owner: MediaIndex
--

ALTER TABLE ONLY public.voice_search
    ADD CONSTRAINT voice_search_track_fkey FOREIGN KEY (track) REFERENCES public.track(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict UvPt1LcCLPJ5uCvbB6yXtLVKbclURL4qNu223wS6fuhjj08l6mh9GTduTudnVDB

