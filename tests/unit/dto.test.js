'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminUser, publicAuthor, selfUser } = require('../../server/dto');

function syntheticUser(overrides = {}) {
  return {
    id: 'a0b1c2d3-e4f5-4678-9abc-0123456789ab',
    username: 'Pessoa Sintética',
    email: 'synthetic@example.invalid',
    password_hash: 'synthetic-password-hash',
    passwordHash: 'synthetic-password-hash-camel',
    token: 'synthetic-token',
    auth_version: 8,
    authVersion: 8,
    adm_tentativa_usada: true,
    is_staff: true,
    avatar: '/synthetic-avatar.png',
    title: 'Membro de teste',
    bio: 'Perfil sintético.',
    role: 'moderador',
    posts_count: 14,
    join_date: '2024-02-03',
    disabled_at: null,
    version: 6,
    ...overrides,
  };
}

test('selfUser includes own email and profile while excluding credentials and internal flags', () => {
  const result = selfUser(syntheticUser());
  assert.deepEqual(result, {
    id: 'a0b1c2d3-e4f5-4678-9abc-0123456789ab',
    username: 'Pessoa Sintética',
    email: 'synthetic@example.invalid',
    avatar: '/synthetic-avatar.png',
    title: 'Membro de teste',
    bio: 'Perfil sintético.',
    role: 'moderador',
    posts: 14,
    joinDate: '2024-02-03',
    version: 6,
  });
});

test('publicAuthor exposes exactly the public author subset and never email', () => {
  const result = publicAuthor(syntheticUser());
  assert.deepEqual(result, {
    id: 'a0b1c2d3-e4f5-4678-9abc-0123456789ab',
    username: 'Pessoa Sintética',
    avatar: '/synthetic-avatar.png',
    title: 'Membro de teste',
    role: 'moderador',
  });
  assert.equal(Object.hasOwn(result, 'email'), false);
});

test('adminUser exposes only the restricted account fields needed for administration', () => {
  const result = adminUser(syntheticUser());
  assert.deepEqual(result, {
    id: 'a0b1c2d3-e4f5-4678-9abc-0123456789ab',
    username: 'Pessoa Sintética',
    email: 'synthetic@example.invalid',
    role: 'moderador',
    disabledAt: null,
    version: 6,
    joinDate: '2024-02-03',
  });
});

test('all DTOs exclude password, token, auth version and role-puzzle fields', () => {
  for (const dto of [selfUser, publicAuthor, adminUser]) {
    const encoded = JSON.stringify(dto(syntheticUser()));
    for (const forbidden of [
      'synthetic-password-hash', 'synthetic-token', 'authVersion', 'auth_version',
      'adm_tentativa_usada', 'is_staff',
    ]) {
      assert.equal(encoded.includes(forbidden), false, `${dto.name} must exclude ${forbidden}`);
    }
  }
});
