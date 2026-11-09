'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createTimelineRouter, publicTimelineEvent } = require('../../server/timeline');

describe('TIMELINE UNIT TESTS', () => {
  test('publicTimelineEvent formata os campos do evento com segurança', () => {
    const raw = {
      id: 'a0000000-0000-0000-0000-000000000001',
      internal_id: 'EV1',
      title: 'Vincent nasce',
      short_title: 'Vincent nasce',
      summary: 'Nascimento de Vincent Strauss.',
      color: 'Green',
      era: 'Before Daare',
      start_date: 'Before Daare 60',
      end_date: 'Before Daare 60',
      order_index: 1,
      tags: 'Backstory; Público',
      story_arc: '',
      characters: 'Vincent',
      character_group: 'Udjat',
      location: '',
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    };

    const formatted = publicTimelineEvent(raw);
    assert.equal(formatted.id, 'a0000000-0000-0000-0000-000000000001');
    assert.equal(formatted.internalId, 'EV1');
    assert.equal(formatted.title, 'Vincent nasce');
    assert.equal(formatted.shortTitle, 'Vincent nasce');
    assert.equal(formatted.color, 'Green');
    assert.equal(formatted.era, 'Before Daare');
    assert.equal(formatted.startDate, 'Before Daare 60');
    assert.equal(formatted.orderIndex, 1);
    assert.equal(formatted.characters, 'Vincent');
    assert.equal(formatted.characterGroup, 'Udjat');
  });

  test('createTimelineRouter expõe endpoints da API e valida dependências', () => {
    assert.throws(
      () => createTimelineRouter({}),
      /createTimelineRouter requires an injected postgres sql client/
    );

    const dummySql = async () => [];
    const dummyAuth = {
      requireIdentity: (req, res, next) => next(),
      requireRole: () => (req, res, next) => next(),
    };

    const router = createTimelineRouter({ sql: dummySql, auth: dummyAuth });
    assert.equal(typeof router, 'function');
  });
});
