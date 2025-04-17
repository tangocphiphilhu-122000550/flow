const axios = require('axios');
const chalk = require('chalk'); // Sử dụng chalk@4.1.2 để hiển thị màu sắc

// Hàm delay (để chờ nếu cần)
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// AccessToken của bạn (thay thế bằng accessToken thực tế)
const accessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJfaWQiOiI2N2ZiOGMzZWU5MGYwNTg0Y2ViNzAyNjQiLCJlbWFpbCI6InBoaXRhMTM0N0BnbWFpbC5jb20iLCJpYXQiOjE3NDQ2OTA3MDAsImV4cCI6MTc0NDY5NDMwMH0.AziLFEcbSwpvhIL0i4LpaFToytwzlDQ7JfpSGcjv1qg'; // Thay thế bằng accessToken của bạn

// Hàm thực hiện yêu cầu HTTP với cơ chế thử lại khi gặp lỗi 502 hoặc 429
async function makeRequestWithRetry(config, retries = 3, delayMs = 2000) {
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
        console.log(chalk.yellow(`⚠️ Lỗi 429 Too Many Requests. Chờ ${retryAfter / 1000} giây trước khi thử lại...`));
        await delay(retryAfter);
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

// Hàm gọi API lấy danh sách task điểm danh hằng ngày
async function getDailyCheckInTasks() {
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

    const tasks = response.data.data;
    console.log(chalk.green('✅ Danh sách task điểm danh hằng ngày:'));
    tasks.forEach((task, index) => {
      console.log(chalk.cyan(`Task ${index + 1}:`));
      console.log(`  - Tên: ${task.name}`);
      console.log(`  - ID: ${task._id}`);
      console.log(`  - Trạng thái: ${task.status}`);
      console.log(`  - Phần thưởng: ${task.reward || 'Không có thông tin'}`);
      console.log('-------------------');
    });

    return tasks;
  } catch (error) {
    console.log(chalk.red('❌ Lỗi khi lấy danh sách task điểm danh:'), error.message);
    if (error.response) {
      console.log(chalk.red('Phản hồi từ máy chủ:'), error.response.data);
    }
    throw error;
  }
}

// Hàm chính để chạy chương trình
async function run() {
  if (!accessToken || accessToken === 'YOUR_ACCESS_TOKEN_HERE') {
    console.log(chalk.red('❌ Vui lòng thay thế YOUR_ACCESS_TOKEN_HERE bằng accessToken của bạn!'));
    return;
  }

  console.log(chalk.cyan('🚀 Đang lấy danh sách task điểm danh hằng ngày...'));
  try {
    await getDailyCheckInTasks();
  } catch (error) {
    console.log(chalk.red('❌ Chương trình kết thúc với lỗi.'));
  }
}

// Chạy chương trình
run();