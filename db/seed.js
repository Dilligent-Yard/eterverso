const data = require('./seed-data');
const queries = require('./queries');
const { pool } = require('./db');

async function seed() {
  var categoryIds = {};
  for (var i = 0; i < data.categories.length; i++) {
    var cat = data.categories[i];
    var created = await queries.createCategory(cat.name, cat.desc);
    categoryIds[cat.key] = created.id;
  }

  var userIds = {};
  for (var j = 0; j < data.users.length; j++) {
    var u = data.users[j];
    var createdUser = await queries.createUser(u.username, u.email, u.password);
    userIds[u.key] = createdUser.id;
    if (u.role !== 'member') {
      await queries.setUserRole(createdUser.id, u.role, u.title);
    }
  }

  var threadIds = {};
  for (var k = 0; k < data.threads.length; k++) {
    var thread = data.threads[k];
    var createdThread = await queries.createThread(categoryIds[thread.categoryKey], userIds[thread.authorKey], thread.title, thread.tag);
    threadIds[thread.key] = createdThread.id;
    await queries.createPost(createdThread.id, userIds[thread.authorKey], thread.content);
  }

  for (var m = 0; m < data.personagens.length; m++) {
    var p = data.personagens[m];
    await queries.createPersonagem(userIds[p.authorKey], p);
  }

  console.log('Seed concluído.');
  await pool.end();
}

seed().catch(function(err) {
  console.error(err);
  process.exit(1);
});
