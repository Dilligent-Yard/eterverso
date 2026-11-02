'use strict';

const { validateUuid } = require('./validation');

const ROLES = new Set(['member', 'moderador', 'admin']);

function firstDefined(record, snakeCase, camelCase) {
  if (Object.hasOwn(record, snakeCase)) return record[snakeCase];
  return record[camelCase];
}

function userId(user) {
  return validateUuid(user.id, 'id');
}

function userRole(user) {
  const role = user.role;
  if (!ROLES.has(role)) {
    throw new TypeError('A conta possui um papel inválido para serialização.');
  }
  return role;
}

/** Serialize the authenticated user's own safe profile, including their email. */
function selfUser(user) {
  return {
    id: userId(user),
    username: user.username,
    email: user.email,
    avatar: user.avatar,
    title: user.title,
    bio: user.bio,
    role: userRole(user),
    posts: firstDefined(user, 'forum_posts_count', 'forumPostsCount')
      ?? firstDefined(user, 'posts_count', 'postsCount'),
    joinDate: firstDefined(user, 'join_date', 'joinDate'),
    version: user.version,
  };
}

/** Serialize the exact public author fields; email and account data stay private. */
function publicAuthor(user) {
  return {
    id: userId(user),
    username: user.username,
    avatar: user.avatar,
    title: user.title,
    role: userRole(user),
  };
}

/** Serialize the minimal account fields required for administrator account actions. */
function adminUser(user) {
  return {
    id: userId(user),
    username: user.username,
    email: user.email,
    role: userRole(user),
    disabledAt: firstDefined(user, 'disabled_at', 'disabledAt'),
    version: user.version,
    joinDate: firstDefined(user, 'join_date', 'joinDate'),
  };
}

module.exports = { adminUser, publicAuthor, selfUser };
