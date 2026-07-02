CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(120) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  avatar TEXT DEFAULT '',
  title VARCHAR(100) DEFAULT '',
  bio TEXT DEFAULT '',
  role VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'moderador', 'admin')),
  posts_count INTEGER NOT NULL DEFAULT 0,
  adm_tentativa_usada BOOLEAN NOT NULL DEFAULT FALSE,
  join_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users(id),
  title VARCHAR(200) NOT NULL,
  tag VARCHAR(20) DEFAULT '',
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  views INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  edited BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE personagens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id UUID NOT NULL REFERENCES users(id),
  nome VARCHAR(100) NOT NULL,
  categoria VARCHAR(50) DEFAULT '',
  titulo VARCHAR(100) DEFAULT '',
  raca VARCHAR(80) DEFAULT '',
  faccao VARCHAR(120) DEFAULT '',
  status VARCHAR(80) DEFAULT '',
  imagem TEXT DEFAULT '',
  descricao TEXT DEFAULT '',
  stats JSONB DEFAULT '{}',
  skills JSONB DEFAULT '[]',
  apex_tier VARCHAR(60) DEFAULT '',
  mascara_tier VARCHAR(60) DEFAULT '',
  wa VARCHAR(30) DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  personagem_id UUID NOT NULL REFERENCES personagens(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_threads_category_id ON threads(category_id);
CREATE INDEX idx_posts_thread_id ON posts(thread_id);
CREATE INDEX idx_personagens_author_id ON personagens(author_id);
CREATE INDEX idx_comments_personagem_id ON comments(personagem_id);
