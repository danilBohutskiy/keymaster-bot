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

// Проверка на админа
function isAdmin(ctx) {
  return ctx.from.id === ADMIN_ID;
}

// Создаем более информативное главное меню
const mainMenu = Markup.keyboard([
  ['🔑 Текущий ключ', '📋 Список ключей'],
  ['🔄 Смена ключа', '♻️ Сбросить всё'],
  ['ℹ️ Детали', '📊 Статистика']
]).resize();

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
  
  if (data === 'back_to_details') {
    await ctx.deleteMessage();
    await ctx.reply("Возвращаемся к списку ключей...");
    
    // Вызываем обработчик кнопки "Детали"
    const keys = await loadKeys();
    if (!keys || keys.length === 0) {
      return ctx.reply("Список ключей пуст");
    }
    
    const names = keys.map(k => k.name);
    const chunkSize = 3;
    const keyboardButtons = [];
    
    for (let i = 0; i < names.length; i += chunkSize) {
      keyboardButtons.push(names.slice(i, i + chunkSize).map(n => "🔍 " + n));
    }

    keyboardButtons.push(['⬅️ Назад']);

    await ctx.reply("Выберите ключ для просмотра деталей:", Markup.keyboard(keyboardButtons).resize());
    
    return;
  }

  if (data === 'back') {
    await ctx.deleteMessage();
    await ctx.reply("Главное меню:", mainMenu);
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
 * Обработчик кнопки "Детали"
 */
bot.hears('ℹ️ Детали', async (ctx) => {
  if (!isAdmin(ctx)) return;
  try {
    const keys = await loadKeys();
    if (!keys || keys.length === 0) {
      return ctx.reply("Список ключей пуст");
    }
    
    const names = keys.map(k => k.name);
    const chunkSize = 3;
    const keyboardButtons = [];
    
    for (let i = 0; i < names.length; i += chunkSize) {
      keyboardButtons.push(names.slice(i, i + chunkSize).map(n => "🔍 " + n));
    }

    keyboardButtons.push(['⬅️ Назад']);

    await ctx.reply("Выберите ключ для просмотра деталей:", Markup.keyboard(keyboardButtons).resize());
  } catch (error) {
    console.error("Ошибка при получении деталей ключей:", error);
    ctx.reply("⚠️ Произошла ошибка при получении деталей ключей.");
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
 * Обработчик выбора ключа для смены
 */
bot.hears(/^🔄 ([\w\d_-]+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return;
  try {
    const name = ctx.match[1];
    const keys = await loadKeys();
    const match = keys.find(k => k.name === name);
    
    if (!match) {
      return ctx.reply("❌ Ключ не найден.");
    }
    
    // Сбрасываем статус "текущий" у всех ключей
    keys.forEach(k => k.current = false);
    
    // Устанавливаем выбранный ключ как текущий
    match.current = true;
    match.lastUsed = new Date().toISOString();
    await saveKeys(keys);
    
    ctx.reply(`✅ Ключ *${name}* установлен как текущий.`, { 
      parse_mode: "Markdown",
      reply_markup: mainMenu
    });
    
    // Показываем информацию о ключе
    await sendActiveKeyInfo(ctx);
  } catch (error) {
    console.error("Ошибка при смене ключа:", error);
    ctx.reply("⚠️ Произошла ошибка при смене ключа.");
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