require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const {
  loadKeys,
  saveKeys,
  formatKeyList,
  getActiveKey,
  getNextActiveKey,
  resetAllKeys,
  markKeyExhausted,
  getKeyInfo
} = require("./keys");

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = Number(process.env.ADMIN_ID);

function isAdmin(ctx) {
  return ctx.from.id === ADMIN_ID;
}

const mainMenu = Markup.keyboard([
  ['🔑 Текущий ключ', '📋 Список ключей'],
  ['🔄 Смена ключа', '⚙️ Управление ключами'],
  ['♻️ Сбросить всё', '📊 Статистика']
]).resize();

const keyManagementMenu = Markup.keyboard([
  ['➕ Добавить ключ', '🗑️ Удалить ключ'],
  ['👁️ Просмотр ключа', '⬅️ Назад']
]).resize();

let userState = {};
function clearUserState(userId) {
  delete userState[userId];
}

/**
 * Отправка информации о текущем ключе
 */
async function sendActiveKeyInfo(ctx) {
  try {
    const keys = await loadKeys();
    const active = getActiveKey(keys);
    
    if (!active) {
      return ctx.reply("❌ Нет активных ключей.", Markup.keyboard([
        ['♻️ Сбросить всё', '⬅️ Назад']
      ]).resize());
    }
    
    active.lastUsed = new Date().toISOString();
    await saveKeys(keys);
    
    // Подсчитываем общую статистику для информативности
    const totalKeys = keys.length;
    const activeKeys = keys.filter(k => k.active).length;

    const keyboardButtons = [
      [{ text: "🚫 Отметить исчерпанным", callback_data: `exhaust_${active.name}` }],
      [{ text: "⏭️ Следующий ключ", callback_data: "next_key" }]
    ];

    await ctx.reply(
      `*Текущий ключ*\n\n` +
      `📝 *Название:* ${active.name}\n` +
      `🔑 *Ключ:* \`${active.value}\`\n\n` +
      `📊 *Статистика:* ${activeKeys}/${totalKeys} активных ключей`,
      {
        parse_mode: "MarkdownV2",
        reply_markup: {
          inline_keyboard: keyboardButtons
        }
      }
    );
  } catch (error) {
    console.error("Ошибка при получении активного ключа:", error);
    ctx.reply("⚠️ Произошла ошибка при получении активного ключа.");
  }
}

/**
 * Обработчик команды /start
 */
bot.start(async (ctx) => {
  if (!isAdmin(ctx)) return;
  await ctx.reply("👋 *Добро пожаловать в Keymaster Bot*", { parse_mode: "Markdown" });
  
  // Сразу показываем информацию о текущем ключе при старте
  await sendActiveKeyInfo(ctx);
  await ctx.reply("Выберите действие:", mainMenu);
});

/**
 * Обработчик кнопки "Текущий ключ"
 */
bot.hears('🔑 Текущий ключ', async (ctx) => {
  if (!isAdmin(ctx)) return;
  await sendActiveKeyInfo(ctx);
});

/**
 * Обработчик callback-запросов
 */
bot.on('callback_query', async (ctx) => {
  if (!isAdmin(ctx)) return;
  
  const data = ctx.callbackQuery.data;

  if (data === 'next_key') {
    try {
      const keys = await loadKeys();
      const active = getActiveKey(keys);
      
      if (!active) {
        await ctx.answerCbQuery("❌ Нет активных ключей");
        return;
      }
      
      // Переключаемся на следующий ключ
      const nextKey = getNextActiveKey(keys, active.name);
      
      if (nextKey) {
        // Отмечаем текущий как использованный для статистики
        active.lastUsed = new Date().toISOString();
        await saveKeys(keys);
        
        await ctx.answerCbQuery(`✅ Переключено на ключ ${nextKey.name}`);
        await ctx.deleteMessage();
        
        // Отправляем информацию о новом ключе
        const totalKeys = keys.length;
        const activeKeys = keys.filter(k => k.active).length;
        
        await ctx.reply(
          `*Следующий ключ*\n\n` +
          `📝 *Название:* ${nextKey.name}\n` +
          `🔑 *Ключ:* \`${nextKey.value}\`\n\n` +
          `📊 *Статистика:* ${activeKeys}/${totalKeys} активных ключей`,
          {
            parse_mode: "MarkdownV2",
            reply_markup: {
              inline_keyboard: [
                [{ text: "🚫 Отметить исчерпанным", callback_data: `exhaust_${nextKey.name}` }],
                [{ text: "⏭️ Следующий ключ", callback_data: "next_key" }]
              ]
            }
          }
        );
      } else {
        await ctx.answerCbQuery("❌ Больше нет активных ключей");
        await ctx.reply("❌ Больше нет активных ключей.");
      }
    } catch (error) {
      console.error("Ошибка при переключении ключа:", error);
      await ctx.answerCbQuery("⚠️ Произошла ошибка");
      ctx.reply("⚠️ Произошла ошибка при переключении ключа.");
    }
    
    return;
  }

  if (data.startsWith('exhaust_')) {
    try {
      const name = data.slice(8);
      const keys = await loadKeys();
      
      // Отмечаем текущий ключ как исчерпанный
      const success = markKeyExhausted(keys, name);
      if (!success) {
        await ctx.answerCbQuery("❌ Ключ не найден");
        return;
      }
      
      // Сохраняем изменения
      await saveKeys(keys);
      await ctx.answerCbQuery(`Ключ "${name}" отмечен как исчерпанный`);
      await ctx.deleteMessage();
      
      await ctx.reply(`⚠️ Ключ *${name}* отмечен как исчерпанный.`, { parse_mode: "Markdown" });
      
      // Ищем следующий активный ключ по порядку
      const nextKey = getNextActiveKey(keys, name);
      
      if (nextKey) {
        // Обновляем дату последнего использования и сохраняем
        nextKey.lastUsed = new Date().toISOString();
        await saveKeys(keys);
        
        // Подсчитываем общую статистику
        const totalKeys = keys.length;
        const activeKeys = keys.filter(k => k.active).length;
        
        // Отправляем информацию о следующем ключе
        await ctx.reply(
          `*Новый активный ключ:*\n\n` +
          `📝 *Название:* ${nextKey.name}\n` +
          `🔑 *Ключ:* \`${nextKey.value}\`\n\n` +
          `📊 *Статистика:* ${activeKeys}/${totalKeys} активных ключей`,
          {
            parse_mode: "MarkdownV2",
            reply_markup: {
              inline_keyboard: [
                [{ text: "🚫 Отметить исчерпанным", callback_data: `exhaust_${nextKey.name}` }],
                [{ text: "⏭️ Следующий ключ", callback_data: "next_key" }]
              ]
            }
          }
        );
      } else {
        await ctx.reply("❌ Больше нет активных ключей.", Markup.keyboard([
          ['♻️ Сбросить всё', '⬅️ Назад']
        ]).resize());
      }
    } catch (error) {
      console.error("Ошибка при обработке исчерпания ключа:", error);
      ctx.reply("⚠️ Произошла ошибка при обработке запроса.");
    }
    
    return;
  }
  
  if (data.startsWith('activate_')) {
    try {
      const name = data.slice(9);
      const keys = await loadKeys();
      
      // Находим ключ
      const key = keys.find(k => k.name === name);
      if (!key) {
        await ctx.answerCbQuery("❌ Ключ не найден");
        return;
      }
      
      // Активируем ключ
      key.active = true;
      key.exhausted = false;
      key.lastUsed = new Date().toISOString();
      
      // Сохраняем изменения
      await saveKeys(keys);
      await ctx.answerCbQuery(`Ключ "${name}" активирован`);
      await ctx.deleteMessage();
      
      await ctx.reply(`✅ Ключ *${name}* активирован и готов к использованию.`, { 
        parse_mode: "Markdown",
        reply_markup: mainMenu
      });
      
    } catch (error) {
      console.error("Ошибка при активации ключа:", error);
      await ctx.answerCbQuery("⚠️ Произошла ошибка");
      ctx.reply("⚠️ Произошла ошибка при активации ключа.");
    }
    
    return;
  }

  if (data === 'back') {
    await ctx.deleteMessage();
    await ctx.reply("Главное меню:", mainMenu);
    return;
  }

  if (data === 'back_to_management') {
    await ctx.deleteMessage();
    await ctx.reply("Управление ключами:", keyManagementMenu);
    return;
  }
});

/**
 * Обработчик кнопки "Список ключей"
 */
bot.hears('📋 Список ключей', async (ctx) => {
  if (!isAdmin(ctx)) return;
  try {
    const keys = await loadKeys();
    const text = formatKeyList(keys);
    ctx.reply(text, { 
      reply_markup: {
        inline_keyboard: [
          [{ text: "⬅️ Назад", callback_data: "back" }]
        ]
      }
    });
  } catch (error) {
    console.error("Ошибка при получении списка ключей:", error);
    ctx.reply("⚠️ Произошла ошибка при получении списка ключей.");
  }
});

/**
 * Обработчик кнопки "Статистика"
 */
bot.hears('📊 Статистика', async (ctx) => {
  if (!isAdmin(ctx)) return;
  try {
    const keys = await loadKeys();
    if (!keys || keys.length === 0) {
      return ctx.reply("Список ключей пуст");
    }
    
    const totalKeys = keys.length;
    const activeKeys = keys.filter(k => k.active).length;
    const exhaustedKeys = keys.filter(k => k.exhausted).length;
    const unusedKeys = keys.filter(k => !k.lastUsed).length;
    
    // Находим наиболее часто используемый ключ
    const usedKeys = keys.filter(k => k.lastUsed);
    let mostUsedKey = "нет данных";
    
    if (usedKeys.length > 0) {
      // Сортируем по частоте использования
      // В данном примере просто берем последний использованный
      const lastUsed = usedKeys.sort((a, b) => 
        new Date(b.lastUsed) - new Date(a.lastUsed)
      )[0];
      mostUsedKey = lastUsed.name;
    }
    
    const statsMessage = 
      `📊 *Статистика ключей*\n\n` +
      `📌 Всего ключей: ${totalKeys}\n` +
      `✅ Активных: ${activeKeys}\n` +
      `⛔ Исчерпанных: ${exhaustedKeys}\n` +
      `🆕 Неиспользованных: ${unusedKeys}\n` +
      `🔄 Последний использованный: ${mostUsedKey}`;
    
    ctx.reply(statsMessage, { 
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "⬅️ Назад", callback_data: "back" }]
        ]
      }
    });
  } catch (error) {
    console.error("Ошибка при получении статистики:", error);
    ctx.reply("⚠️ Произошла ошибка при получении статистики.");
  }
});

/**
 * Обработчик названия ключа (для деталей)
 */
bot.hears(/^🔍 ([\w\d_-]+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return;
  try {
    const keyName = ctx.match[1];
    const keys = await loadKeys();
    const info = getKeyInfo(keys, keyName);
    if (info) {
      ctx.reply(info, { 
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Активировать", callback_data: `activate_${keyName}` },
              { text: "🚫 Деактивировать", callback_data: `exhaust_${keyName}` }
            ],
            [{ text: "⬅️ Назад к списку", callback_data: "back_to_details" }]
          ]
        }
      });
    } else {
      ctx.reply("❌ Ключ не найден.");
    }
  } catch (error) {
    console.error("Ошибка при получении информации о ключе:", error);
    ctx.reply("⚠️ Произошла ошибка при получении информации о ключе.");
  }
});

/**
 * Обработчик кнопки "Смена ключа"
 */
bot.hears('🔄 Смена ключа', async (ctx) => {
  if (!isAdmin(ctx)) return;
  try {
    const keys = await loadKeys();
    const activeKeys = keys.filter(k => k.active);
    
    if (activeKeys.length === 0) {
      return ctx.reply("❌ Нет активных ключей.", Markup.keyboard([
        ['♻️ Сбросить всё', '⬅️ Назад']
      ]).resize());
    }
    
    const names = activeKeys.map(k => k.name);
    const chunkSize = 2;
    const keyboardButtons = [];
    
    for (let i = 0; i < names.length; i += chunkSize) {
      keyboardButtons.push(names.slice(i, i + chunkSize).map(n => "🔄 " + n));
    }

    keyboardButtons.push(['⬅️ Назад']);

    ctx.reply("Выберите ключ для активации:", Markup.keyboard(keyboardButtons).resize());
  } catch (error) {
    console.error("Ошибка при получении ключей:", error);
    ctx.reply("⚠️ Произошла ошибка при получении ключей.");
  }
});

/**
 * Обработчик кнопки "Назад"
 */
bot.hears('⬅️ Назад', (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.reply("Главное меню:", mainMenu);
});

/**
 * Обработчик кнопки "Сбросить всё"
 */
bot.hears('♻️ Сбросить всё', async (ctx) => {
  if (!isAdmin(ctx)) return;
  try {
    const keys = await loadKeys();
    resetAllKeys(keys);  // активирует все ключи
    await saveKeys(keys);
    ctx.reply("✅ Все ключи сброшены и активированы.", mainMenu);
    
    // Показываем информацию о текущем ключе
    await sendActiveKeyInfo(ctx);
  } catch (error) {
    console.error("Ошибка при сбросе ключей:", error);
    ctx.reply("⚠️ Произошла ошибка при сбросе ключей.");
  }
});

// Обработчик кнопки "Управление ключами"
bot.hears('⚙️ Управление ключами', async (ctx) => {
  if (!isAdmin(ctx)) return;
  await ctx.reply("Выберите действие:", keyManagementMenu);
});

// Обработчик кнопки "Добавить ключ"
bot.hears('➕ Добавить ключ', async (ctx) => {
  if (!isAdmin(ctx)) return;
  
  userState[ctx.from.id] = { 
    action: 'adding_key',
    step: 'name'
  };
  
  await ctx.reply(
    "📝 Введите название ключа (например: key1, account2, api_key_1):",
    Markup.keyboard([['❌ Отмена']]).resize()
  );
});

// Обработчик кнопки "Удалить ключ"
bot.hears('🗑️ Удалить ключ', async (ctx) => {
  if (!isAdmin(ctx)) return;
  
  try {
    const keys = await loadKeys();
    if (!keys || keys.length === 0) {
      return ctx.reply("Список ключей пуст", keyManagementMenu);
    }
    
    const names = keys.map(k => k.name);
    const chunkSize = 3;
    const keyboardButtons = [];
    
    for (let i = 0; i < names.length; i += chunkSize) {
      keyboardButtons.push(names.slice(i, i + chunkSize).map(n => "🗑️ " + n));
    }
    
    keyboardButtons.push(['❌ Отмена']);
    
    await ctx.reply("Выберите ключ для удаления:", Markup.keyboard(keyboardButtons).resize());
  } catch (error) {
    console.error("Ошибка при получении списка ключей:", error);
    ctx.reply("⚠️ Произошла ошибка при получении списка ключей.");
  }
});

// Обработчик кнопки "Просмотр ключа"
bot.hears('👁️ Просмотр ключа', async (ctx) => {
  if (!isAdmin(ctx)) return;
  
  try {
    const keys = await loadKeys();
    if (!keys || keys.length === 0) {
      return ctx.reply("Список ключей пуст", keyManagementMenu);
    }
    
    const names = keys.map(k => k.name);
    const chunkSize = 3;
    const keyboardButtons = [];
    
    for (let i = 0; i < names.length; i += chunkSize) {
      keyboardButtons.push(names.slice(i, i + chunkSize).map(n => "👁️ " + n));
    }
    
    keyboardButtons.push(['❌ Отмена']);
    
    await ctx.reply("Выберите ключ для просмотра:", Markup.keyboard(keyboardButtons).resize());
  } catch (error) {
    console.error("Ошибка при получении списка ключей:", error);
    ctx.reply("⚠️ Произошла ошибка при получении списка ключей.");
  }
});

// Обработчик удаления ключа
bot.hears(/^🗑️ ([\w\d_-]+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return;
  
  try {
    const keyName = ctx.match[1];
    const keys = await loadKeys();
    const keyIndex = keys.findIndex(k => k.name === keyName);
    
    if (keyIndex === -1) {
      return ctx.reply("❌ Ключ не найден.", keyManagementMenu);
    }
    
    // Удаляем ключ
    keys.splice(keyIndex, 1);
    await saveKeys(keys);
    
    await ctx.reply(`🗑️ Ключ *${keyName}* удален.`, { 
      parse_mode: "Markdown",
      reply_markup: keyManagementMenu
    });
    
  } catch (error) {
    console.error("Ошибка при удалении ключа:", error);
    ctx.reply("⚠️ Произошла ошибка при удалении ключа.");
  }
});

// Обработчик просмотра ключа
bot.hears(/^👁️ ([\w\d_-]+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return;
  
  try {
    const keyName = ctx.match[1];
    const keys = await loadKeys();
    const info = getKeyInfo(keys, keyName);
    
    if (info) {
      ctx.reply(info, { 
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Активировать", callback_data: `activate_${keyName}` },
              { text: "🚫 Деактивировать", callback_data: `exhaust_${keyName}` }
            ],
            [{ text: "⬅️ Назад", callback_data: "back_to_management" }]
          ]
        }
      });
    } else {
      ctx.reply("❌ Ключ не найден.", keyManagementMenu);
    }
  } catch (error) {
    console.error("Ошибка при получении информации о ключе:", error);
    ctx.reply("⚠️ Произошла ошибка при получении информации о ключе.");
  }
});

// Обработчик кнопки "Отмена"
bot.hears('❌ Отмена', async (ctx) => {
  if (!isAdmin(ctx)) return;
  
  clearUserState(ctx.from.id);
  await ctx.reply("Операция отменена.", keyManagementMenu);
});

// Обработчик текстовых сообщений для добавления ключа
bot.on('text', async (ctx) => {
  if (!isAdmin(ctx)) return;
  
  const userId = ctx.from.id;
  const state = userState[userId];
  
  if (!state || state.action !== 'adding_key') return;
  
  try {
    const text = ctx.message.text.trim();
    
    if (state.step === 'name') {
      // Проверяем корректность названия
      if (!/^[\w\d_-]+$/.test(text)) {
        return ctx.reply("❌ Название может содержать только буквы, цифры, дефисы и подчеркивания. Попробуйте снова:");
      }
      
      // Проверяем, не существует ли уже такой ключ
      const keys = await loadKeys();
      if (keys.find(k => k.name === text)) {
        return ctx.reply("❌ Ключ с таким названием уже существует. Введите другое название:");
      }
      
      state.keyData = { name: text };
      state.step = 'value';
      
      await ctx.reply("🔑 Теперь введите значение ключа (API key, токен и т.д.):");
      
    } else if (state.step === 'value') {
      state.keyData.value = text;
      state.step = 'email';
      
      await ctx.reply(
        "📧 Введите email для этого ключа (или отправьте 'пропустить' если не нужно):",
        Markup.keyboard([['⏭️ Пропустить', '❌ Отмена']]).resize()
      );
      
    } else if (state.step === 'email') {
      if (text.toLowerCase() !== 'пропустить') {
        state.keyData.email = text;
      }
      state.step = 'password';
      
      await ctx.reply(
        "🔐 Введите пароль для этого ключа (или отправьте 'пропустить' если не нужно):",
        Markup.keyboard([['⏭️ Пропустить', '❌ Отмена']]).resize()
      );
      
    } else if (state.step === 'password') {
      if (text.toLowerCase() !== 'пропустить') {
        state.keyData.password = text;
      }
      
      // Сохраняем ключ
      const keys = await loadKeys();
      const newKey = {
        name: state.keyData.name,
        value: state.keyData.value,
        active: true,
        current: keys.length === 0, // Первый ключ делаем текущим
        exhausted: false,
        lastUsed: null,
        email: state.keyData.email || null,
        password: state.keyData.password || null
      };
      
      keys.push(newKey);
      await saveKeys(keys);
      
      clearUserState(userId);
      
      let successMessage = `✅ Ключ *${newKey.name}* успешно добавлен!\n\n`;
      successMessage += `🔑 *Значение:* \`${newKey.value}\`\n`;
      if (newKey.email) successMessage += `📧 *Email:* ${newKey.email}\n`;
      if (newKey.password) successMessage += `🔐 *Пароль:* ${newKey.password}\n`;
      
      await ctx.reply(successMessage, { 
        parse_mode: "Markdown",
        reply_markup: keyManagementMenu
      });
    }
    
  } catch (error) {
    console.error("Ошибка при добавлении ключа:", error);
    clearUserState(userId);
    ctx.reply("⚠️ Произошла ошибка при добавлении ключа.", keyManagementMenu);
  }
});

// Обработчик кнопки "Пропустить"
bot.hears('⏭️ Пропустить', async (ctx) => {
  if (!isAdmin(ctx)) return;
  
  const userId = ctx.from.id;
  const state = userState[userId];
  
  if (!state || state.action !== 'adding_key') return;
  
  if (state.step === 'email') {
    state.step = 'password';
    await ctx.reply(
      "🔐 Введите пароль для этого ключа (или отправьте 'пропустить' если не нужно):",
      Markup.keyboard([['⏭️ Пропустить', '❌ Отмена']]).resize()
    );
  } else if (state.step === 'password') {
    // Сохраняем ключ без пароля
    try {
      const keys = await loadKeys();
      const newKey = {
        name: state.keyData.name,
        value: state.keyData.value,
        active: true,
        current: keys.length === 0,
        exhausted: false,
        lastUsed: null,
        email: state.keyData.email || null,
        password: null
      };
      
      keys.push(newKey);
      await saveKeys(keys);
      
      clearUserState(userId);
      
      let successMessage = `✅ Ключ *${newKey.name}* успешно добавлен!\n\n`;
      successMessage += `🔑 *Значение:* \`${newKey.value}\`\n`;
      if (newKey.email) successMessage += `📧 *Email:* ${newKey.email}\n`;
      
      await ctx.reply(successMessage, { 
        parse_mode: "Markdown",
        reply_markup: keyManagementMenu
      });
      
    } catch (error) {
      console.error("Ошибка при добавлении ключа:", error);
      clearUserState(userId);
      ctx.reply("⚠️ Произошла ошибка при добавлении ключа.", keyManagementMenu);
    }
  }
});


/**
 * Обработчик ошибок
 */
bot.catch((err, ctx) => {
  console.error('Ошибка в обработчике:', err);
  if (ctx && ctx.reply) {
    ctx.reply('⚠️ Произошла ошибка. Возвращаемся в главное меню.').then(() => {
      ctx.reply('Выберите действие:', mainMenu);
    });
  }
});

// Запускаем бота
bot.launch()
  .then(() => console.log('🤖 Keymaster Bot успешно запущен'))
  .catch(err => console.error('❌ Ошибка при запуске бота:', err));

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));