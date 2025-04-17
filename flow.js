const http = require('http');
const axios = require('axios');
const fs = require('fs').promises;
const chalk = require('chalk');
const jwt = require('jsonwebtoken');

// Tạo server HTTP để nhận ping và hỗ trợ health check
const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Flow Automation is running');
  }
});
server.listen(process.env.PORT || 8080, () => {
  console.log(chalk.cyan('🌐 Ping server running on port', process.env.PORT || 8080));
});

// Biến để theo dõi trạng thái tạm dừng do lỗi 429
let isPausedDueToRateLimit = false;
let pauseUntil = 0;

// Hàm delay
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Hàm giải mã accessToken để lấy email
function decodeAccessToken(accessToken) {
  try {
    const decoded = jwt.decode(accessToken);
    return decoded ? decoded.email : 'Không xác định';
  } catch (error) {
    console.error(chalk.red('❌ Lỗi khi giải mã accessToken:'), error.message);
    return 'Không xác định';
  }
}

// Hàm đảm bảo file tồn tại
async function ensureFileExists(filePath) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, '');
  }
}

// Hàm đọc accessToken từ file data.txt
async function readAccessTokens() {
  try {
    const data = await fs.readFile('/app/data/data.txt', 'utf8');
    return data
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line);
  } catch (error) {
    console.error(chalk.red('❌ Lỗi khi đọc file data.txt:'), error.message);
    return [];
  }
}

// Hàm đọc refreshToken từ file refeshtokens.txt
async function readRefreshTokens() {
  try {
    const data = await fs.readFile('/app/data/refeshtokens.txt', 'utf8');
    return data
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line);
  } catch (error) {
    console.error(chalk.red('❌ Lỗi khi đọc file refeshtokens.txt:'), error.message);
    return [];
  }
}

// Hàm định dạng thời gian thành chuỗi ngày giờ
function formatDateTime(timestamp) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// Hàm chuyển chuỗi ngày giờ thành timestamp
function parseDateTime(dateTimeStr) {
  const date = new Date(dateTimeStr);
  return date.getTime();
}

// Hàm đọc thời gian điểm danh cuối cùng từ file lastCheckIn.txt
async function readLastCheckIn() {
  try {
    const data = await fs.readFile('/app/data/lastCheckIn.txt', 'utf8');
    const checkInMap = {};
    data
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line)
      .forEach((line) => {
        const [email, dateTimeStr] = line.split('|');
        const timestamp = parseDateTime(dateTimeStr);
        checkInMap[email] = timestamp;
      });
    return checkInMap;
  } catch (error) {
    return {};
  }
}

// Hàm lưu thời gian điểm danh vào file lastCheckIn.txt
async function saveLastCheckIn(checkInMap) {
  const data = Object.entries(checkInMap)
    .map(([email, timestamp]) => `${email}|${formatDateTime(timestamp)}`)
    .join('\n');
  await fs.writeFile('/app/data/lastCheckIn.txt', data);
}

// Hàm đọc danh sách nhiệm vụ đã hoàn thành từ file completedTasks.txt
async function readCompletedTasks() {
  try {
    const data = await fs.readFile('/app/data/completedTasks.txt', 'utf8');
    const completedTasks = new Set();
    data
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line)
      .forEach((line) => {
        const [email, taskId] = line.split('|');
        completedTasks.add(`${email}|${taskId}`);
      });
    return completedTasks;
  } catch (error) {
    return new Set();
  }
}

// Hàm lưu nhiệm vụ đã hoàn thành vào file completedTasks.txt
async function saveCompletedTask(email, taskId, taskName, completedTasks) {
  completedTasks.add(`${email}|${taskId}`);
  const data = Array.from(completedTasks)
    .map((task) => {
      const [taskEmail, taskId] = task.split('|');
      return `${taskEmail}|${taskId}|${taskName}`;
    })
    .join('\n');
  await fs.writeFile('/app/data/completedTasks.txt', data);
}

// Hàm đọc trạng thái proxy từ file proxyStatus.txt (dù không dùng proxy, vẫn giữ để tương thích logic)
async function readProxyStatus() {
  try {
    const data = await fs.readFile('/app/data/proxyStatus.txt', 'utf8');
    const proxyStatusMap = {};
    data
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line)
      .forEach((line) => {
        const [email, useProxy] = line.split('|');
        proxyStatusMap[email] = useProxy === 'true';
      });
    return proxyStatusMap;
  } catch (error) {
    return {};
  }
}

// Hàm lưu trạng thái proxy vào file proxyStatus.txt
async function saveProxyStatus(proxyStatusMap) {
  const data = Object.entries(proxyStatusMap)
    .map(([email, useProxy]) => `${email}|${useProxy}`)
    .join('\n');
  await fs.writeFile('/app/data/proxyStatus.txt', data);
}

// Hàm kiểm tra xem đã điểm danh trong ngày chưa
function hasCheckedInToday(lastCheckInTimestamp) {
  if (!lastCheckInTimestamp) return false;

  const lastCheckInDate = new Date(lastCheckInTimestamp);
  const currentDate = new Date();

  return (
    lastCheckInDate.getDate() === currentDate.getDate() &&
    lastCheckInDate.getMonth() === currentDate.getMonth() &&
    lastCheckInDate.getFullYear() === currentDate.getFullYear()
  );
}

// Hàm kiểm tra xem đã đủ 24 giờ kể từ lần điểm danh cuối cùng chưa
function hasWaited24Hours(lastCheckInTimestamp) {
  if (!lastCheckInTimestamp) return true;

  const lastCheckInDate = new Date(lastCheckInTimestamp);
  const currentDate = new Date();
  const timeDiff = currentDate - lastCheckInDate;
  const hoursDiff = timeDiff / (1000 * 60 * 60);

  return hoursDiff >= 24;
}

// Hàm lưu accessToken vào file data.txt
async function saveAccessTokens(accessTokens) {
  const data = accessTokens.join('\n');
  await fs.writeFile('/app/data/data.txt', data);
}

// Hàm lưu refreshToken vào file refeshtokens.txt
async function saveRefreshTokens(refreshTokens) {
  const data = refreshTokens.join('\n');
  await fs.writeFile('/app/data/refeshtokens.txt', data);
}

// Hàm thực hiện yêu cầu HTTP với cơ chế thử lại khi gặp lỗi 502 hoặc 429
async function makeRequestWithRetry(config, retries = 5, delayMs = 5000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios(config);
      return response;
    } catch (error) {
      if (error.response && error.response.status === 502) {
        if (attempt === retries) {
          throw new Error(`Hết số lần thử (${retries}) - Lỗi 502 Bad Gateway`);
        }
        console.log(chalk.yellow(`⚠️ Lỗi 502 Bad Gateway (Thử ${attempt}/${retries}). Thử lại sau ${delayMs / 1000} giây...`));
        await delay(delayMs);
      } else if (error.response && error.response.status === 429) {
        const retryAfter = error.response.headers['retry-after']
          ? parseInt(error.response.headers['retry-after'], 10) * 1000
          : 60000;
        console.log(chalk.yellow(`⚠️ Lỗi 429 Too Many Requests. Tạm dừng toàn bộ xử lý trong ${retryAfter / 1000} giây...`));
        
        isPausedDueToRateLimit = true;
        pauseUntil = Date.now() + retryAfter;
        await delay(retryAfter);
        isPausedDueToRateLimit = false;
        
        if (attempt === retries) {
          throw new Error(`Hết số lần thử (${retries}) - Lỗi 429 Too Many Requests`);
        }
        console.log(chalk.cyan(`🔄 Tiếp tục thử lại yêu cầu (Thử ${attempt}/${retries})...`));
      } else {
        throw error;
      }
    }
  }
}

// Hàm kiểm tra AccessToken có hợp lệ không
async function checkAccessTokenValidity(accessToken) {
  try {
    await makeRequestWithRetry({
      method: 'get',
      url: 'https://api2.flow3.tech/api/user/get-earn-stats',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        accept: 'application/json, text/plain, */*',
        'accept-language': 'vi,fr-FR;q=0.9,fr;q=0.8,en-US;q=0.7,en;q=0.6',
        'sec-ch-ua': '"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        origin: 'https://app.flow3.tech',
        referer: 'https://app.flow3.tech/',
      },
    });
    return true;
  } catch (error) {
    if (error.response?.status === 401) {
      return false;
    }
    throw error;
  }
}

// Hàm làm mới accessToken
async function refreshAccessToken(oldAccessToken, refreshToken) {
  if (!oldAccessToken || oldAccessToken === 'undefined' || !refreshToken || refreshToken === 'undefined') {
    throw new Error('AccessToken hoặc refreshToken không hợp lệ');
  }

  try {
    const response = await makeRequestWithRetry({
      method: 'post',
      url: 'https://api2.flow3.tech/api/user/refresh',
      data: { refreshToken },
      headers: {
        Authorization: `Bearer ${oldAccessToken}`,
        accept: 'application/json, text/plain, */*',
        'accept-language': 'vi,fr-FR;q=0.9,fr;q=0.8,en-US;q=0.7,en;q=0.6',
        'content-type': 'application/json',
        'sec-ch-ua': '"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        origin: 'https://app.flow3.tech',
        referer: 'https://app.flow3.tech/',
      },
    });

    const { accessToken, refreshToken: newRefreshToken } = response.data.data;
    return { accessToken, refreshToken: newRefreshToken || refreshToken };
  } catch (error) {
    throw error;
  }
}

// Hàm gọi API lấy danh sách task điểm danh hằng ngày
async function getDailyCheckInTasks(accessToken) {
  try {
    const response = await makeRequestWithRetry({
      method: 'get',
      url: 'https://api2.flow3.tech/api/task/get-user-task-daily',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        accept: 'application/json, text/plain, */*',
        'accept-language': 'vi,fr-FR;q=0.9,fr;q=0.8,en-US;q=0.7,en;q=0.6',
        'sec-ch-ua': '"Chromium";v="134", "Not:A-Brand";v="24", "Google Chrome";v="134"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
        origin: 'https://app.flow3.tech',
        referer: 'https://app.flow3.tech/',
      },
    });
    return response.data.data;
  } catch (error) {
    throw error;
  }
}

// Hàm gọi API thực hiện điểm danh hằng ngày
async function performDailyCheckIn(accessToken, taskId) {
  try {
    const response = await makeRequestWithRetry({
      method: 'post',
      url: 'https://api2.flow3.tech/api/task/daily-check-in',
      data: { taskId },
      headers: {
        Authorization: `Bearer ${accessToken}`,
        accept: 'application/json, text/plain, */*',
        'accept-language': 'vi,fr-FR;q=0.9,fr;q=0.8,en-US;q=0.7,en;q=0.6',
        'content-type': 'application/json',
        'sec-ch-ua': '"Chromium";v="134", "Not:A-Brand";v="24", "Google Chrome";v="134"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
        origin: 'https://app.flow3.tech',
        referer: 'https://app.flow3.tech/',
      },
    });
    return response.data;
  } catch (error) {
    throw error;
  }
}

// Hàm xử lý điểm danh hằng ngày
async function checkInDaily(accessToken, email, checkInMap) {
  try {
    const lastCheckInTimestamp = checkInMap[email] || 0;

    if (hasCheckedInToday(lastCheckInTimestamp)) {
      console.log(chalk.gray(`⏳ Tài khoản ${email}: Chưa đủ 24 giờ nên chưa thể checkin, đợi lần sau.`));
      return { status: 'success' };
    }

    const dailyTasks = await getDailyCheckInTasks(accessToken);

    const allClaimed = dailyTasks.every((task) => task.status === 'claimed');
    if (allClaimed) {
      console.log(chalk.gray(`⏳ Tài khoản ${email}: Đã hoàn thành tất cả các ngày điểm danh.`));
      checkInMap[email] = Date.now();
      await saveLastCheckIn(checkInMap);
      return { status: 'success' };
    }

    let claimedCount = 0;
    for (const task of dailyTasks) {
      if (task.status === 'claimed') {
        claimedCount++;
      } else {
        break;
      }
    }

    const taskToCheckIn = dailyTasks[claimedCount];

    if (!taskToCheckIn) {
      console.log(chalk.red(`❌ Tài khoản ${email}: Không tìm thấy task điểm danh phù hợp.`));
      return { status: 'error' };
    }

    if (taskToCheckIn.status === 'locked') {
      if (!hasWaited24Hours(lastCheckInTimestamp)) {
        console.log(chalk.gray(`⏳ Tài khoản ${email}: Chưa đủ 24 giờ nên chưa thể checkin, đợi lần sau.`));
        return { status: 'success' };
      }

      console.log(
        chalk.yellow(
          `⚠️ Tài khoản ${email}: Đã đủ 24 giờ nhưng ${taskToCheckIn.name} vẫn khóa. Sẽ kiểm tra lại ở vòng lặp sau.`
        )
      );
      return { status: 'pending' };
    }

    const taskId = taskToCheckIn._id;
    const taskName = taskToCheckIn.name;
    console.log(chalk.cyan(`🔄 Đang thực hiện điểm danh: ${taskName}...`));

    try {
      await performDailyCheckIn(accessToken, taskId);

      const updatedTasks = await getDailyCheckInTasks(accessToken);
      const updatedTask = updatedTasks[claimedCount];

      if (!updatedTask || updatedTask.status === 'locked') {
        console.log(
          chalk.yellow(
            `⚠️ Tài khoản ${email}: Điểm danh ${taskName} thất bại - Task vẫn bị khóa. Sẽ kiểm tra lại ở vòng lặp sau.`
          )
        );
        return { status: 'pending' };
      }

      if (updatedTask.status !== 'claimed') {
        console.log(
          chalk.red(
            `❌ Tài khoản ${email}: Điểm danh ${taskName} thất bại - Trạng thái sau điểm danh là ${updatedTask.status}.`
          )
        );
        return { status: 'error' };
      }

      checkInMap[email] = Date.now();
      await saveLastCheckIn(checkInMap);
      console.log(chalk.green(`📅 Tài khoản ${email}: Điểm danh ${taskName} thành công!`));
      return { status: 'success' };
    } catch (error) {
      console.log(chalk.red(`❌ Tài khoản ${email}: Điểm danh ${taskName} thất bại - ${error.message}`));
      throw error;
    }
  } catch (error) {
    console.log(chalk.red(`❌ Tài khoản ${email}: Điểm danh hằng ngày thất bại - ${error.message}`));
    throw error;
  }
}

// Hàm gọi API lấy danh sách nhiệm vụ
async function getUserTasks(accessToken) {
  try {
    const response = await makeRequestWithRetry({
      method: 'get',
      url: 'https://api2.flow3.tech/api/task/get-user-task',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        accept: 'application/json, text/plain, */*',
        'accept-language': 'vi,fr-FR;q=0.9,fr;q=0.8,en-US;q=0.7,en;q=0.6',
        'sec-ch-ua': '"Chromium";v="134", "Not:A-Brand";v="24", "Google Chrome";v="134"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
        origin: 'https://app.flow3.tech',
        referer: 'https://app.flow3.tech/',
      },
    });
    return response.data.data;
  } catch (error) {
    throw error;
  }
}

// Hàm gọi API thực hiện nhiệm vụ
async function doTask(accessToken, taskId) {
  try {
    const response = await makeRequestWithRetry({
      method: 'post',
      url: 'https://api2.flow3.tech/api/task/do-task',
      data: { taskId },
      headers: {
        Authorization: `Bearer ${accessToken}`,
        accept: 'application/json, text/plain, */*',
        'accept-language': 'vi,fr-FR;q=0.9,fr;q=0.8,en-US;q=0.7,en;q=0.6',
        'content-type': 'application/json',
        'sec-ch-ua': '"Chromium";v="134", "Not:A-Brand";v="24", "Google Chrome";v="134"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
        origin: 'https://app.flow3.tech',
        referer: 'https://app.flow3.tech/',
      },
    });
    return response.data;
  } catch (error) {
    throw error;
  }
}

// Hàm gọi API claim phần thưởng nhiệm vụ
async function claimTask(accessToken, taskId) {
  try {
    const response = await makeRequestWithRetry({
      method: 'post',
      url: 'https://api2.flow3.tech/api/task/claim-task',
      data: { taskId },
      headers: {
        Authorization: `Bearer ${accessToken}`,
        accept: 'application/json, text/plain, */*',
        'accept-language': 'vi,fr-FR;q=0.9,fr;q=0.8,en-US;q=0.7,en;q=0.6',
        'content-type': 'application/json',
        'sec-ch-ua': '"Chromium";v="134", "Not:A-Brand";v="24", "Google Chrome";v="134"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
        origin: 'https://app.flow3.tech',
        referer: 'https://app.flow3.tech/',
      },
    });
    return response.data;
  } catch (error) {
    throw error;
  }
}

// Hàm thực hiện tất cả các nhiệm vụ
async function performTasks(accessToken, email, completedTasks) {
  let hasTasks = false;

  try {
    let tasks = await getUserTasks(accessToken);

    for (const task of tasks) {
      const taskId = task._id;
      const taskName = task.name;
      const taskStatus = task.status;

      if (completedTasks.has(`${email}|${taskId}`) || taskStatus !== 'idle') {
        continue;
      }

      hasTasks = true;
      console.log(chalk.cyan(`🔄 Đang thực hiện nhiệm vụ "${taskName}"...`));

      try {
        await doTask(accessToken, taskId);

        tasks = await getUserTasks(accessToken);
        const updatedTask = tasks.find((t) => t._id === taskId);
        if (!updatedTask || updatedTask.status !== 'pending') {
          throw new Error(`Nhiệm vụ không chuyển sang trạng thái "pending".`);
        }

        await claimTask(accessToken, taskId);

        tasks = await getUserTasks(accessToken);
        const claimedTask = tasks.find((t) => t._id === taskId);
        if (!claimedTask || claimedTask.status !== 'claimed') {
          throw new Error(`Nhiệm vụ không chuyển sang trạng thái "claimed".`);
        }

        await saveCompletedTask(email, taskId, taskName, completedTasks);
        console.log(chalk.green(`✅ Nhiệm vụ "${taskName}" đã hoàn thành.`));
      } catch (error) {
        console.log(chalk.red(`❌ Nhiệm vụ "${taskName}" bị lỗi, bỏ qua...`));
        continue;
      }

      await delay(2000);
    }
  } catch (error) {
    console.log(chalk.red(`❌ Lỗi khi lấy danh sách nhiệm vụ - ${error.message}`));
    throw error;
  }

  return hasTasks;
}

// Hàm gọi API get-earn-stats
async function getEarnStats(accessToken) {
  try {
    const response = await makeRequestWithRetry({
      method: 'get',
      url: 'https://api2.flow3.tech/api/user/get-earn-stats',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        accept: 'application/json, text/plain, */*',
        'accept-language': 'vi,fr-FR;q=0.9,fr;q=0.8,en-US;q=0.7,en;q=0.6',
        'sec-ch-ua': '"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        origin: 'https://app.flow3.tech',
        referer: 'https://app.flow3.tech/',
      },
    });
    return response.data.data;
  } catch (error) {
    throw error;
  }
}

// Hàm gọi API get-connection-quality và get-earn-stats
async function checkConnectionQuality(index, accessTokens, refreshTokens, checkInMap, completedTasks, proxyStatusMap) {
  let accessToken = accessTokens[index];
  let refreshToken = refreshTokens[index];
  const email = decodeAccessToken(accessToken);

  if (!accessToken || accessToken === 'undefined' || !refreshToken || refreshToken === 'undefined') {
    console.log(chalk.red(`❌ Tài khoản ${email}: Token không hợp lệ. Bỏ qua...`));
    return { success: false, email };
  }

  let isTokenValid = false;
  try {
    isTokenValid = await checkAccessTokenValidity(accessToken);
  } catch (error) {
    if (error.message.includes('Lỗi 502 Bad Gateway')) {
      console.log(chalk.red(`❌ Tài khoản ${email}: Lỗi 502 Bad Gateway sau nhiều lần thử. Bỏ qua...`));
      return { success: false, email };
    }
    throw error;
  }

  if (!isTokenValid) {
    console.log(chalk.yellow(`⚠️ Tài khoản ${email}: AccessToken hết hạn, đang làm mới...`));
    try {
      const newTokens = await refreshAccessToken(accessToken, refreshToken);
      accessTokens[index] = newTokens.accessToken;
      refreshTokens[index] = newTokens.refreshToken;
      await saveAccessTokens(accessTokens);
      await saveRefreshTokens(refreshTokens);
      accessToken = newTokens.accessToken;
      console.log(chalk.green(`✅ AccessToken đã được làm mới thành công cho tài khoản ${email}`));
    } catch (refreshError) {
      console.log(chalk.red(`❌ Tài khoản ${email}: Không thể làm mới token. Bỏ qua...`));
      return { success: false, email };
    }
  }

  try {
    const checkInResult = await checkInDaily(accessToken, email, checkInMap);

    if (checkInResult.status === 'error') {
      return { success: false, email };
    }

    const hasTasks = await performTasks(accessToken, email, completedTasks);

    const connectionResponse = await makeRequestWithRetry({
      method: 'get',
      url: 'https://api2.flow3.tech/api/user/get-connection-quality',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        accept: 'application/json, text/plain, */*',
        'accept-language': 'vi,fr-FR;q=0.9,fr;q=0.8,en-US;q=0.7,en;q=0.6',
        'sec-ch-ua': '"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        origin: 'https://app.flow3.tech',
        referer: 'https://app.flow3.tech/',
      },
    });

    const earnStats = await getEarnStats(accessToken);

    if (!hasTasks) {
      console.log(chalk.green(`✅ Đã hoàn thành tất cả task cho tài khoản này`));
    }

    console.log(chalk.green(`✅ Tài khoản ${email}:`));
    console.log(chalk.green(`   - Chất lượng kết nối: ${connectionResponse.data.data}`));
    console.log(chalk.green(`   - Điểm hôm nay: ${earnStats.todayPointEarned}`));
    console.log(chalk.green(`   - Tổng điểm: ${earnStats.totalPointEarned}`));
    return { success: true, email };
  } catch (error) {
    if (error.message.includes('Lỗi 502 Bad Gateway')) {
      console.log(chalk.red(`❌ Tài khoản ${email}: Lỗi 502 Bad Gateway sau nhiều lần thử. Bỏ qua...`));
      return { success: false, email };
    }
    console.log(chalk.red(`❌ Tài khoản ${email}: Lỗi - ${error.message}`));
    return { success: false, email };
  }
}

// Hàm chính để chạy vòng lặp qua các token
async function runApiCalls() {
  // Đảm bảo các file tồn tại
  await ensureFileExists('/app/data/data.txt');
  await ensureFileExists('/app/data/refeshtokens.txt');
  await ensureFileExists('/app/data/lastCheckIn.txt');
  await ensureFileExists('/app/data/completedTasks.txt');
  await ensureFileExists('/app/data/proxyStatus.txt');

  let accessTokens = await readAccessTokens();
  let refreshTokens = await readRefreshTokens();
  let checkInMap = await readLastCheckIn();
  let completedTasks = await readCompletedTasks();
  let proxyStatusMap = await readProxyStatus();

  if (accessTokens.length === 0 || refreshTokens.length === 0) {
    console.error(chalk.red('❌ Không tìm thấy token trong file data.txt hoặc refeshtokens.txt'));
    return;
  }

  if (accessTokens.length !== refreshTokens.length) {
    console.error(chalk.red('❌ Số lượng accessToken và refreshToken không khớp'));
    return;
  }

  console.log(chalk.magenta('🌟🌟🌟 Phi Phi Airdrop Automation Tool 🌟🌟🌟'));
  console.log(chalk.magenta('🚀 Được phát triển bởi Phi Phi - Chuyên gia tự động hóa hàng đầu 🚀'));
  console.log(chalk.magenta('💻 Tăng tốc hành trình săn airdrop của bạn ngay hôm nay! 💻'));
  console.log(chalk.cyan('🚀 Bắt đầu chạy chương trình...'));
  console.log(chalk.cyan(`📊 Tổng số tài khoản: ${accessTokens.length}`));

  let currentIndex = 0;
  let isProcessing = false;

  const processNextAccount = async () => {
    if (isPausedDueToRateLimit) {
      const remainingTime = pauseUntil - Date.now();
      if (remainingTime > 0) {
        console.log(chalk.yellow(`⏳ Đang tạm dừng do lỗi 429, chờ thêm ${remainingTime / 1000} giây...`));
        await delay(remainingTime);
      }
      isPausedDueToRateLimit = false;
    }

    if (isProcessing) return;
    isProcessing = true;

    const email = decodeAccessToken(accessTokens[currentIndex]);
    console.log(chalk.cyan(`---------------- ${email} -------------------`));
    console.log(chalk.cyan(`🔄 Đang xử lý tài khoản: ${email}`));

    const result = await checkConnectionQuality(
      currentIndex,
      accessTokens,
      refreshTokens,
      checkInMap,
      completedTasks,
      proxyStatusMap
    );

    if (!result.success) {
      console.log(chalk.gray(`⏭️ Bỏ qua tài khoản ${email}`));
    }

    currentIndex = (currentIndex + 1) % accessTokens.length;
    isProcessing = false;
  };

  setInterval(processNextAccount, 20000);
}

// Chạy chương trình
runApiCalls().catch((error) => {
  console.error(chalk.red('❌ Lỗi trong chương trình:'), error.message);
});

// Xử lý lỗi toàn cục
process.on('uncaughtException', (error) => {
  console.error(chalk.red('❌ Lỗi toàn cục:'), error.message);
});

process.on('unhandledRejection', (reason) => {
  console.error(chalk.red('❌ Lỗi Promise:'), reason);
});
