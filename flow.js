const axios = require('axios');
const fs = require('fs').promises;
const chalk = require('chalk'); // Sử dụng chalk@4.1.2
const jwt = require('jsonwebtoken'); // Thêm thư viện jsonwebtoken để giải mã JWT
const { HttpsProxyAgent } = require('https-proxy-agent'); // Thêm thư viện để xử lý proxy
const readline = require('readline'); // Thêm thư viện để đọc input từ người dùng

// Tạo giao diện để đọc input từ người dùng
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Biến để theo dõi trạng thái tạm dừng do lỗi 429
let isPausedDueToRateLimit = false;
let pauseUntil = 0;

// Hàm delay (để chờ trước khi retry hoặc giữa các yêu cầu)
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Hàm hỏi người dùng về việc sử dụng proxy
function askUseProxy() {
  return new Promise((resolve) => {
    rl.question('Bạn có muốn sử dụng proxy không? (Y/N): ', (answer) => {
      resolve(answer.trim().toUpperCase() === 'Y');
    });
  });
}

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

// Hàm đọc proxy từ file proxy.txt
async function readProxies() {
  try {
    const data = await fs.readFile('proxy.txt', 'utf8');
    return data
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line);
  } catch (error) {
    console.error(chalk.red('❌ Lỗi khi đọc file proxy.txt:'), error.message);
    return [];
  }
}

// Hàm đọc trạng thái proxy từ file proxyStatus.txt
async function readProxyStatus() {
  try {
    const data = await fs.readFile('proxyStatus.txt', 'utf8');
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
    // Nếu file không tồn tại hoặc lỗi, trả về object rỗng
    return {};
  }
}

// Hàm lưu trạng thái proxy vào file proxyStatus.txt
async function saveProxyStatus(proxyStatusMap) {
  const data = Object.entries(proxyStatusMap)
    .map(([email, useProxy]) => `${email}|${useProxy}`)
    .join('\n');
  await fs.writeFile('proxyStatus.txt', data);
}

// Hàm đọc accessToken từ file data.txt
async function readAccessTokens() {
  try {
    const data = await fs.readFile('data.txt', 'utf8');
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
    const data = await fs.readFile('refeshtokens.txt', 'utf8');
    return data
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line);
  } catch (error) {
    console.error(chalk.red('❌ Lỗi khi đọc file refeshtokens.txt:'), error.message);
    return [];
  }
}

// Hàm định dạng thời gian thành chuỗi ngày giờ (theo thời gian hệ thống)
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

// Hàm chuyển chuỗi ngày giờ thành timestamp (theo thời gian hệ thống)
function parseDateTime(dateTimeStr) {
  const date = new Date(dateTimeStr);
  return date.getTime();
}

// Hàm đọc thời gian điểm danh cuối cùng từ file lastCheckIn.txt
async function readLastCheckIn() {
  try {
    const data = await fs.readFile('lastCheckIn.txt', 'utf8');
    const checkInMap = {};
    data
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line)
      .forEach((line) => {
        const [email, dateTimeStr] = line.split('|');
        // Chuyển chuỗi ngày giờ thành timestamp
        const timestamp = parseDateTime(dateTimeStr);
        checkInMap[email] = timestamp;
      });
    return checkInMap;
  } catch (error) {
    // Nếu file không tồn tại hoặc lỗi, trả về object rỗng
    return {};
  }
}

// Hàm lưu thời gian điểm danh vào file lastCheckIn.txt
async function saveLastCheckIn(checkInMap) {
  const data = Object.entries(checkInMap)
    .map(([email, timestamp]) => `${email}|${formatDateTime(timestamp)}`)
    .join('\n');
  await fs.writeFile('lastCheckIn.txt', data);
}

// Hàm đọc danh sách nhiệm vụ đã hoàn thành từ file completedTasks.txt
async function readCompletedTasks() {
  try {
    const data = await fs.readFile('completedTasks.txt', 'utf8');
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
    // Nếu file không tồn tại hoặc lỗi, trả về Set rỗng
    return new Set();
  }
}

// Hàm lưu nhiệm vụ đã hoàn thành vào file completedTasks.txt
async function saveCompletedTask(email, taskId, taskName, completedTasks) {
  completedTasks.add(`${email}|${taskId}`);
  const data = Array.from(completedTasks)
    .map((task) => {
      const [taskEmail, taskId] = task.split('|');
      return `${taskEmail}|${taskId}|${taskName}`; // Lưu cả taskName để dễ đọc
    })
    .join('\n');
  await fs.writeFile('completedTasks.txt', data);
}

// Hàm kiểm tra xem đã điểm danh trong ngày chưa
function hasCheckedInToday(lastCheckInTimestamp) {
  if (!lastCheckInTimestamp) return false;

  const lastCheckInDate = new Date(lastCheckInTimestamp);
  const currentDate = new Date();

  // So sánh ngày, tháng, năm
  return (
    lastCheckInDate.getDate() === currentDate.getDate() &&
    lastCheckInDate.getMonth() === currentDate.getMonth() &&
    lastCheckInDate.getFullYear() === currentDate.getFullYear()
  );
}

// Hàm kiểm tra xem đã đủ 24 giờ kể từ lần điểm danh cuối cùng chưa
function hasWaited24Hours(lastCheckInTimestamp) {
  if (!lastCheckInTimestamp) return true; // Nếu chưa có lần điểm danh nào, cho phép

  const lastCheckInDate = new Date(lastCheckInTimestamp);
  const currentDate = new Date();
  const timeDiff = currentDate - lastCheckInDate; // Thời gian chênh lệch (ms)
  const hoursDiff = timeDiff / (1000 * 60 * 60); // Chuyển sang giờ

  return hoursDiff >= 24; // Đã đủ 24 giờ chưa
}

// Hàm lưu accessToken vào file data.txt
async function saveAccessTokens(accessTokens) {
  const data = accessTokens.join('\n');
  await fs.writeFile('data.txt', data);
}

// Hàm lưu refreshToken vào file refeshtokens.txt
async function saveRefreshTokens(refreshTokens) {
  const data = refreshTokens.join('\n');
  await fs.writeFile('refeshtokens.txt', data);
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
          : 60000; // Mặc định chờ 60 giây nếu không có Retry-After
        console.log(chalk.yellow(`⚠️ Lỗi 429 Too Many Requests. Tạm dừng toàn bộ xử lý trong ${retryAfter / 1000} giây...`));
        
        // Tạm dừng toàn bộ xử lý
        isPausedDueToRateLimit = true;
        pauseUntil = Date.now() + retryAfter;
        await delay(retryAfter);
        isPausedDueToRateLimit = false;
        
        if (attempt === retries) {
          throw new Error(`Hết số lần thử (${retries}) - Lỗi 429 Too Many Requests`);
        }
        console.log(chalk.cyan(`🔄 Tiếp tục thử lại yêu cầu (Thử ${attempt}/${retries})...`));
      } else {
        throw error; // Ném lỗi nếu không phải 502 hoặc 429
      }
    }
  }
}

// Hàm kiểm tra AccessToken có hợp lệ không bằng cách gọi API get-earn-stats
async function checkAccessTokenValidity(accessToken, proxyAgent) {
  try {
    await makeRequestWithRetry({
      method: 'get',
      url: 'https://api2.flow3.tech/api/user/get-earn-stats',
      httpsAgent: proxyAgent,
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
    return true; // Token hợp lệ
  } catch (error) {
    if (error.response?.status === 401) {
      return false; // Token hết hạn
    }
    throw error; // Lỗi khác
  }
}

// Hàm làm mới accessToken bằng refreshToken và accessToken cũ
async function refreshAccessToken(oldAccessToken, refreshToken, proxyAgent, retryCount = 3) {
  if (!oldAccessToken || oldAccessToken === 'undefined' || !refreshToken || refreshToken === 'undefined') {
    throw new Error('AccessToken hoặc refreshToken không hợp lệ');
  }

  try {
    const response = await makeRequestWithRetry({
      method: 'post',
      url: 'https://api2.flow3.tech/api/user/refresh',
      data: { refreshToken },
      httpsAgent: proxyAgent,
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
async function getDailyCheckInTasks(accessToken, proxyAgent) {
  try {
    const response = await makeRequestWithRetry({
      method: 'get',
      url: 'https://api2.flow3.tech/api/task/get-user-task-daily',
      httpsAgent: proxyAgent,
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
    return response.data.data; // Trả về mảng các task điểm danh hằng ngày
  } catch (error) {
    throw error;
  }
}

// Hàm gọi API thực hiện điểm danh hằng ngày
async function performDailyCheckIn(accessToken, taskId, proxyAgent) {
  try {
    const response = await makeRequestWithRetry({
      method: 'post',
      url: 'https://api2.flow3.tech/api/task/daily-check-in',
      data: { taskId },
      httpsAgent: proxyAgent,
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
async function checkInDaily(accessToken, proxyAgent, email, checkInMap) {
  try {
    const lastCheckInTimestamp = checkInMap[email] || 0;

    if (hasCheckedInToday(lastCheckInTimestamp)) {
      console.log(chalk.gray(`⏳ Tài khoản ${email}: Chưa đủ 24 giờ nên chưa thể checkin, đợi lần sau.`));
      return { status: 'success' }; // Trả về trạng thái thành công để tiếp tục xử lý
    }

    // Lấy danh sách task điểm danh
    const dailyTasks = await getDailyCheckInTasks(accessToken, proxyAgent);

    // Kiểm tra xem tất cả các task đã claimed chưa
    const allClaimed = dailyTasks.every((task) => task.status === 'claimed');
    if (allClaimed) {
      console.log(chalk.gray(`⏳ Tài khoản ${email}: Đã hoàn thành tất cả các ngày điểm danh.`));
      checkInMap[email] = Date.now();
      await saveLastCheckIn(checkInMap);
      return { status: 'success' };
    }

    // Đếm số task đã claimed để xác định task tiếp theo
    let claimedCount = 0;
    for (const task of dailyTasks) {
      if (task.status === 'claimed') {
        claimedCount++;
      } else {
        break;
      }
    }

    // Task tiếp theo là task tại vị trí claimedCount
    const taskToCheckIn = dailyTasks[claimedCount];

    if (!taskToCheckIn) {
      console.log(chalk.red(`❌ Tài khoản ${email}: Không tìm thấy task điểm danh phù hợp.`));
      return { status: 'error' };
    }

    // Nếu task tiếp theo bị khóa
    if (taskToCheckIn.status === 'locked') {
      // Kiểm tra xem đã đủ 24 giờ kể từ lần điểm danh cuối cùng chưa
      if (!hasWaited24Hours(lastCheckInTimestamp)) {
        console.log(chalk.gray(`⏳ Tài khoản ${email}: Chưa đủ 24 giờ nên chưa thể checkin, đợi lần sau.`));
        return { status: 'success' }; // Không lưu thời gian, trả về trạng thái thành công
      }

      // Nếu đã đủ 24 giờ nhưng task vẫn khóa, tiếp tục xử lý các bước khác
      console.log(
        chalk.yellow(
          `⚠️ Tài khoản ${email}: Đã đủ 24 giờ nhưng ${taskToCheckIn.name} vẫn khóa. Sẽ kiểm tra lại ở vòng lặp sau.`
        )
      );
      return { status: 'pending' }; // Trả về trạng thái pending để báo rằng tài khoản này cần kiểm tra lại
    }

    // Nếu task không bị khóa, thực hiện điểm danh
    const taskId = taskToCheckIn._id;
    const taskName = taskToCheckIn.name;
    console.log(chalk.cyan(`🔄 Đang thực hiện điểm danh: ${taskName}...`));

    try {
      // Gọi API điểm danh
      await performDailyCheckIn(accessToken, taskId, proxyAgent);

      // Gọi lại API để kiểm tra trạng thái task sau khi điểm danh
      const updatedTasks = await getDailyCheckInTasks(accessToken, proxyAgent);
      const updatedTask = updatedTasks[claimedCount]; // Task tại vị trí vừa điểm danh

      if (!updatedTask || updatedTask.status === 'locked') {
        console.log(
          chalk.yellow(
            `⚠️ Tài khoản ${email}: Điểm danh ${taskName} thất bại - Task vẫn bị khóa. Sẽ kiểm tra lại ở vòng lặp sau.`
          )
        );
        return { status: 'pending' }; // Trả về trạng thái pending để kiểm tra lại
      }

      if (updatedTask.status !== 'claimed') {
        console.log(
          chalk.red(
            `❌ Tài khoản ${email}: Điểm danh ${taskName} thất bại - Trạng thái sau điểm danh là ${updatedTask.status}.`
          )
        );
        return { status: 'error' };
      }

      // Nếu trạng thái là claimed, điểm danh thành công
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
    throw error; // Ném lỗi để hàm gọi có thể xử lý
  }
}

// Hàm gọi API lấy danh sách nhiệm vụ
async function getUserTasks(accessToken, proxyAgent) {
  try {
    const response = await makeRequestWithRetry({
      method: 'get',
      url: 'https://api2.flow3.tech/api/task/get-user-task',
      httpsAgent: proxyAgent,
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

// Hàm gọi API thực hiện nhiệm vụ (do-task)
async function doTask(accessToken, taskId, proxyAgent) {
  try {
    const response = await makeRequestWithRetry({
      method: 'post',
      url: 'https://api2.flow3.tech/api/task/do-task',
      data: { taskId },
      httpsAgent: proxyAgent,
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
async function claimTask(accessToken, taskId, proxyAgent) {
  try {
    const response = await makeRequestWithRetry({
      method: 'post',
      url: 'https://api2.flow3.tech/api/task/claim-task',
      data: { taskId },
      httpsAgent: proxyAgent,
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

// Hàm thực hiện tất cả các nhiệm vụ cho một tài khoản và trả về trạng thái có task hay không
async function performTasks(accessToken, proxyAgent, email, completedTasks) {
  let hasTasks = false;

  try {
    let tasks = await getUserTasks(accessToken, proxyAgent);

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
        await doTask(accessToken, taskId, proxyAgent);

        tasks = await getUserTasks(accessToken, proxyAgent);
        const updatedTask = tasks.find((t) => t._id === taskId);
        if (!updatedTask || updatedTask.status !== 'pending') {
          throw new Error(`Nhiệm vụ không chuyển sang trạng thái "pending".`);
        }

        await claimTask(accessToken, taskId, proxyAgent);

        tasks = await getUserTasks(accessToken, proxyAgent);
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
    throw error; // Ném lỗi để hàm gọi có thể xử lý
  }

  return hasTasks;
}

// Hàm gọi API get-earn-stats để lấy thông tin điểm số
async function getEarnStats(accessToken, proxyAgent) {
  try {
    const response = await makeRequestWithRetry({
      method: 'get',
      url: 'https://api2.flow3.tech/api/user/get-earn-stats',
      httpsAgent: proxyAgent,
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
async function checkConnectionQuality(
  index,
  accessTokens,
  refreshTokens,
  proxyAgent,
  proxyAddress,
  checkInMap,
  completedTasks,
  proxyStatusMap
) {
  let accessToken = accessTokens[index];
  let refreshToken = refreshTokens[index];
  const email = decodeAccessToken(accessToken);

  if (!accessToken || accessToken === 'undefined' || !refreshToken || refreshToken === 'undefined') {
    console.log(chalk.red(`❌ Tài khoản ${email}: Token không hợp lệ. Bỏ qua...`));
    return { success: false, email };
  }

  let currentAgent = proxyAgent;
  let currentProxyAddress = proxyAddress;

  // Kiểm tra AccessToken có hợp lệ không trước khi thực hiện bất kỳ thao tác nào
  let isTokenValid = false;
  try {
    isTokenValid = await checkAccessTokenValidity(accessToken, currentAgent);
  } catch (error) {
    // Xử lý lỗi 502 Bad Gateway
    if (error.message.includes('Lỗi 502 Bad Gateway')) {
      console.log(chalk.red(`❌ Tài khoản ${email}: Lỗi 502 Bad Gateway sau nhiều lần thử. Bỏ qua...`));
      return { success: false, email };
    }
    // Xử lý các lỗi liên quan đến proxy (ENETUNREACH, ECONNREFUSED, ETIMEDOUT)
    if (error.code === 'ENETUNREACH' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      console.log(
        chalk.yellow(
          `⚠️ Proxy ${currentProxyAddress} không khả dụng cho tài khoản ${email}, chuyển sang chế độ không proxy...`
        )
      );
      proxyStatusMap[email] = false; // Chuyển sang không proxy
      await saveProxyStatus(proxyStatusMap);
      currentAgent = null; // Bỏ proxy
      currentProxyAddress = null;
      try {
        isTokenValid = await checkAccessTokenValidity(accessToken, currentAgent);
      } catch (innerError) {
        if (innerError.message.includes('Lỗi 502 Bad Gateway')) {
          console.log(chalk.red(`❌ Tài khoản ${email}: Lỗi 502 Bad Gateway sau nhiều lần thử (không proxy). Bỏ qua...`));
          return { success: false, email };
        }
        throw innerError;
      }
    } else {
      throw error;
    }
  }

  if (!isTokenValid) {
    console.log(chalk.yellow(`⚠️ Tài khoản ${email}: AccessToken hết hạn, đang làm mới...`));
    try {
      const newTokens = await refreshAccessToken(accessToken, refreshToken, currentAgent);
      accessTokens[index] = newTokens.accessToken;
      refreshTokens[index] = newTokens.refreshToken;
      await saveAccessTokens(accessTokens);
      await saveRefreshTokens(refreshTokens);
      accessToken = newTokens.accessToken; // Cập nhật accessToken mới
      console.log(chalk.green(`✅ AccessToken đã được làm mới thành công cho tài khoản ${email}`));
    } catch (refreshError) {
      console.log(chalk.red(`❌ Tài khoản ${email}: Không thể làm mới token. Bỏ qua...`));
      return { success: false, email };
    }
  }

  // Sau khi đảm bảo token hợp lệ, tiếp tục xử lý các bước khác
  try {
    // Xử lý điểm danh hằng ngày
    const checkInResult = await checkInDaily(accessToken, currentAgent, email, checkInMap);

    // Nếu trạng thái là error, bỏ qua tài khoản
    if (checkInResult.status === 'error') {
      return { success: false, email };
    }

    // Tiếp tục thực hiện các bước khác ngay cả khi điểm danh chưa thành công
    const hasTasks = await performTasks(accessToken, currentAgent, email, completedTasks);

    const connectionResponse = await makeRequestWithRetry({
      method: 'get',
      url: 'https://api2.flow3.tech/api/user/get-connection-quality',
      httpsAgent: currentAgent,
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

    const earnStats = await getEarnStats(accessToken, currentAgent);

    if (!hasTasks) {
      console.log(chalk.green(`✅ Đã hoàn thành tất cả task cho tài khoản này`));
    }

    console.log(
      chalk.green(
        `✅ Tài khoản ${email}${currentProxyAddress ? ` với proxy: ${currentProxyAddress.split('@')[1]}` : ''}:`
      )
    );
    console.log(chalk.green(`   - Chất lượng kết nối: ${connectionResponse.data.data}`));
    console.log(chalk.green(`   - Điểm hôm nay: ${earnStats.todayPointEarned}`));
    console.log(chalk.green(`   - Tổng điểm: ${earnStats.totalPointEarned}`));
    return { success: true, email };
  } catch (error) {
    // Xử lý lỗi 502 Bad Gateway trong các bước khác
    if (error.message.includes('Lỗi 502 Bad Gateway')) {
      console.log(chalk.red(`❌ Tài khoản ${email}: Lỗi 502 Bad Gateway sau nhiều lần thử. Bỏ qua...`));
      return { success: false, email };
    }
    // Xử lý các lỗi liên quan đến proxy trong các bước khác (ENETUNREACH, ECONNREFUSED, ETIMEDOUT)
    if (error.code === 'ENETUNREACH' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      console.log(
        chalk.yellow(
          `⚠️ Proxy ${currentProxyAddress} không khả dụng cho tài khoản ${email}, chuyển sang chế độ không proxy...`
        )
      );
      proxyStatusMap[email] = false; // Chuyển sang không proxy
      await saveProxyStatus(proxyStatusMap);
      return await checkConnectionQuality(
        index,
        accessTokens,
        refreshTokens,
        null,
        null,
        checkInMap,
        completedTasks,
        proxyStatusMap
      );
    }
    console.log(chalk.red(`❌ Tài khoản ${email}: Lỗi - ${error.message}`));
    return { success: false, email };
  }
}

// Hàm chính để chạy vòng lặp qua các token
async function runApiCalls() {
  let accessTokens = await readAccessTokens();
  let refreshTokens = await readRefreshTokens();
  let proxies = await readProxies();
  let checkInMap = await readLastCheckIn();
  let completedTasks = await readCompletedTasks();
  let proxyStatusMap = await readProxyStatus();

  if (accessTokens.length === 0 || refreshTokens.length === 0) {
    console.error(chalk.red('❌ Không tìm thấy token trong file data.txt hoặc refeshtokens.txt'));
    rl.close();
    return;
  }

  if (accessTokens.length !== refreshTokens.length) {
    console.error(chalk.red('❌ Số lượng accessToken và refreshToken không khớp'));
    rl.close();
    return;
  }

  // Hỏi người dùng về việc sử dụng proxy
  const useProxy = await askUseProxy();
  console.log(chalk.cyan(`Sử dụng proxy: ${useProxy ? 'Có' : 'Không'}`));

  // Cập nhật trạng thái proxy cho tất cả tài khoản
  accessTokens.forEach((token) => {
    const email = decodeAccessToken(token);
    proxyStatusMap[email] = useProxy;
  });
  await saveProxyStatus(proxyStatusMap);

  const proxyAgents = accessTokens.map((_, index) => {
    const email = decodeAccessToken(accessTokens[index]);
    const shouldUseProxy = proxyStatusMap[email] !== false; // Dựa trên trạng thái proxy đã lưu
    if (shouldUseProxy && index < proxies.length && proxies[index]) {
      return new HttpsProxyAgent(proxies[index]);
    }
    return null; // Không dùng proxy
  });

  const proxyAddresses = accessTokens.map((_, index) => {
    const email = decodeAccessToken(accessTokens[index]);
    const shouldUseProxy = proxyStatusMap[email] !== false;
    if (shouldUseProxy && index < proxies.length && proxies[index]) {
      return proxies[index];
    }
    return null;
  });

  // Hiển thị tiêu đề hoành tráng
  console.log(chalk.magenta('🌟🌟🌟 Phi Phi Airdrop Automation Tool 🌟🌟🌟'));
  console.log(chalk.magenta('🚀 Được phát triển bởi Phi Phi - Chuyên gia tự động hóa hàng đầu 🚀'));
  console.log(chalk.magenta('💻 Tăng tốc hành trình săn airdrop của bạn ngay hôm nay! 💻'));
  console.log(chalk.cyan('🚀 Bắt đầu chạy chương trình...'));
  console.log(chalk.cyan(`📊 Tổng số tài khoản: ${accessTokens.length}`));
  console.log(chalk.cyan(`🛡️ Tổng số proxy: ${proxies.length}`));

  let currentIndex = 0;
  let isProcessing = false;

  const processNextAccount = async () => {
    // Kiểm tra nếu chương trình đang bị tạm dừng do lỗi 429
    if (isPausedDueToRateLimit) {
      const remainingTime = pauseUntil - Date.now();
      if (remainingTime > 0) {
        console.log(chalk.yellow(`⏳ Đang tạm dừng do lỗi 429, chờ thêm ${remainingTime / 1000} giây...`));
        await delay(remainingTime);
      }
      isPausedDueToRateLimit = false; // Tiếp tục sau khi hết thời gian chờ
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
      proxyAgents[currentIndex],
      proxyAddresses[currentIndex],
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

  // Thời gian chờ giữa các tài khoản 
  setInterval(processNextAccount, 20000);
}

// Chạy chương trình
runApiCalls()
  .then(() => {
    // Đóng giao diện readline khi hoàn tất
    rl.close();
  })
  .catch((error) => {
    console.error(chalk.red('❌ Lỗi trong chương trình:'), error.message);
    rl.close();
  });