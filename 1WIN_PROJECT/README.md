```markdown
# 1WIN - SPA игровая платформа (демо)

Локальный демо-проект "1WIN" — SPA (одностраничное приложение) с бэкендом на Node.js/Express и хранением данных в JSON-файле (атомарные операции через блокировку).

Требования:
- Node.js >= 16

Установка:
1. Склонируйте репозиторий или распакуйте этот проект.
2. В корне выполните:
   npm install
3. Запуск:
   npm start
   (или `npm run dev`, если установлен nodemon)

После запуска сервер доступен по http://localhost:3000 — SPA будет загружена автоматически.

Описание:
- Регистрация: /api/register
- Вход: /api/login (возвращает JWT)
- Поиск игрока: /api/search-user?q=...
- Ежедневный бонус: /api/bonus (POST, auth)
- Кланы: /api/clans, /api/create-clan, /api/join-clan, /api/clan/:id/messages, /api/clan/:id/message, /api/clan/:id/action
- Игры: /api/games/slots, /api/games/rocket, /api/games/basket (POST, auth)
- Банк: /api/bank/deposit, /api/bank/withdraw, /api/bank/transfer (POST, auth)
- Лидеры: /api/leaderboard

Примечания:
- Пароли хранятся в хэше bcrypt.
- DB — db.json; все операции над файлом выполняются с блокировкой (proper-lockfile).
- JWT-секрет в server.js: замените на безопасный в продакшне.
- Интерфейс реализован в public/index.html, public/styles.css, public/app.js.

Тестирование:
- Протестировано локально сценарии регистрации, входа, получения бонуса, создание/вступление в клан, отправка сообщений в чат (polling каждые 3 секунды), игры и банковские операции.
- Если попадутся баги — откройте issue или напишите мне.

Запуск в продакшне:
- Установите переменную окружения JWT_SECRET, настройте reverse proxy (nginx) для HTTPS и запустите node server.js.
```