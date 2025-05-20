// keybot/keys.js
const fs = require("fs/promises");
const path = require("path");
const dayjs = require("dayjs");

const FILE_PATH = path.join(__dirname, "keys.json");

/**
 * Загружает данные о ключах из файла
 * @returns {Promise<Array>} Массив ключей
 */
async function loadKeys() {
  try {
    const data = await fs.readFile(FILE_PATH, "utf-8");
    return JSON.parse(data);
  } catch (err) {
    console.error("Ошибка при чтении файла ключей:", err);
    return [];
  }
}

/**
 * Сохраняет данные о ключах в файл
 * @param {Array} keys Массив ключей
 * @returns {Promise<void>}
 */
async function saveKeys(keys) {
  try {
    await fs.writeFile(FILE_PATH, JSON.stringify(keys, null, 2));
  } catch (err) {
    console.error("Ошибка при сохранении файла ключей:", err);
  }
}

/**
 * Форматирует список ключей для вывода
 * @param {Array} keys Массив ключей
 * @returns {string} Отформатированный текст
 */
function formatKeyList(keys) {
  if (!keys || keys.length === 0) return "Список ключей пуст";
  
  // Улучшенное форматирование списка
  let activeCount = 0;
  let inactiveCount = 0;
  
  const formattedList = keys
    .map((k, i) => {
      const statusEmoji = k.active ? "🟢" : "🔴";
      k.active ? activeCount++ : inactiveCount++;
      
      const currentMark = k.current ? "✅ " : "";
      const exhaustedMark = k.exhausted ? "⛔ " : "";
      const usedTime = k.lastUsed 
        ? `использован ${dayjs(k.lastUsed).format("DD.MM HH:mm")}`
        : "не использовался";
      
      return `${i + 1}. ${statusEmoji} ${currentMark}${exhaustedMark}*${k.name}* — ${usedTime}`;
    })
    .join("\n");
  
  const summary = `\n\n*Статистика:* 🟢 ${activeCount} активных | 🔴 ${inactiveCount} неактивных`;
  
  return `*Список ключей*\n\n${formattedList}${summary}`;
}

/**
 * Возвращает текущий активный ключ
 * @param {Array} keys Массив ключей
 * @returns {Object|null} Активный ключ или null
 */
function getActiveKey(keys) {
  // Сначала проверяем, есть ли ключ, отмеченный как текущий
  const current = keys.find(k => k.active && k.current === true);
  if (current) return current;
  
  // Если текущего нет, берем первый активный
  const active = keys.find(k => k.active);
  if (active) {
    // Отмечаем его как текущий
    active.current = true;
    return active;
  }
  
  return null;
}

/**
 * Возвращает следующий активный ключ по порядку
 * @param {Array} keys Массив ключей
 * @param {string} currentKeyName Имя текущего ключа
 * @returns {Object|null} Следующий активный ключ или null
 */
function getNextActiveKey(keys, currentKeyName) {
  if (!keys || keys.length === 0) return null;
  
  // Сбрасываем статус "текущий" у всех ключей
  keys.forEach(k => k.current = false);
  
  // Находим индекс текущего ключа
  const currentIndex = keys.findIndex(k => k.name === currentKeyName);
  if (currentIndex === -1) {
    // Если текущий ключ не найден, берем первый активный
    const firstActive = keys.find(k => k.active);
    if (firstActive) {
      firstActive.current = true;
      return firstActive;
    }
    return null;
  }
  
  // Перебираем ключи по порядку, начиная со следующего за текущим
  for (let i = 1; i <= keys.length; i++) {
    const nextIndex = (currentIndex + i) % keys.length;
    if (keys[nextIndex] && keys[nextIndex].active) {
      keys[nextIndex].current = true;
      return keys[nextIndex];
    }
  }
  
  return null;
}

/**
 * Сбрасывает все ключи (делает их активными)
 * @param {Array} keys Массив ключей
 */
function resetAllKeys(keys) {
  if (!keys || keys.length === 0) return;
  
  keys.forEach(k => {
    k.active = true;
    k.current = false;
    k.exhausted = false;
  });
  
  // Первый ключ отмечаем как текущий
  if (keys.length > 0) {
    keys[0].current = true;
  }
}

/**
 * Отмечает ключ как исчерпанный
 * @param {Array} keys Массив ключей
 * @param {string} name Имя ключа
 * @returns {boolean} Успех операции
 */
function markKeyExhausted(keys, name) {
  const key = keys.find(k => k.name === name);
  if (!key) return false;
  
  key.active = false;
  key.current = false;
  key.exhausted = true;
  key.lastMarkedExhausted = new Date().toISOString();
  return true;
}

/**
 * Активирует ключ
 * @param {Array} keys Массив ключей 
 * @param {string} name Имя ключа
 * @returns {boolean} Успех операции
 */
function activateKey(keys, name) {
  const key = keys.find(k => k.name === name);
  if (!key) return false;
  
  key.active = true;
  key.exhausted = false;
  return true;
}

/**
 * Получает детальную информацию о ключе
 * @param {Array} keys Массив ключей
 * @param {string} name Имя ключа
 * @returns {string|null} Информация о ключе или null
 */
function getKeyInfo(keys, name) {
  const k = keys.find(k => k.name === name);
  if (!k) return null;
  
  // Улучшенный формат вывода информации о ключе
  const statusEmoji = k.active ? "🟢" : "🔴";
  const status = k.active ? "Активен" : "Неактивен";
  const currentStatus = k.current ? "✅ Текущий" : "";
  const exhaustedStatus = k.exhausted ? "⛔ Исчерпан" : "";
  
  const lastUsed = k.lastUsed 
    ? dayjs(k.lastUsed).format("DD.MM.YYYY, HH:mm") 
    : "никогда";
  const exhausted = k.lastMarkedExhausted 
    ? dayjs(k.lastMarkedExhausted).format("DD.MM.YYYY, HH:mm") 
    : "никогда";
  
  let emailInfo = "";
  if (k.email) {
    emailInfo = `📧 *Email:* ${k.email}\n`;
  }
  
  let passwordInfo = "";
  if (k.password) {
    passwordInfo = `🔐 *Пароль:* ${k.password}\n`;
  }
  
  return `📝 *Информация о ключе*\n\n` +
    `🔑 *Название:* ${k.name}\n` +
    `${statusEmoji} *Статус:* ${status} ${currentStatus} ${exhaustedStatus}\n` +
    `\`${k.value}\`\n\n` +
    emailInfo +
    passwordInfo +
    `🕒 *Последнее использование:* ${lastUsed}\n` +
    `🛑 *Отмечен исчерпанным:* ${exhausted}`;
}

module.exports = {
  loadKeys,
  saveKeys,
  formatKeyList,
  getActiveKey,
  getNextActiveKey,
  resetAllKeys,
  markKeyExhausted,
  activateKey,
  getKeyInfo
};