const readline = require('readline');
const jwt = require('jsonwebtoken');

// Tạo interface để nhập từ terminal
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Nhập JWT Token: ', (token) => {
  try {
    const decoded = jwt.decode(token);

    if (!decoded) {
      console.log('❌ Token không hợp lệ!');
    } else {
      const iat = decoded.iat ? new Date(decoded.iat * 1000).toLocaleString() : 'Không có';
      const exp = decoded.exp ? new Date(decoded.exp * 1000).toLocaleString() : 'Không có';

      console.log('\n✅ Token đã giải mã:');
      console.log('👉 Ngày tạo (iat):', iat);
      console.log('👉 Ngày hết hạn (exp):', exp);
      console.log('👉 Payload đầy đủ:\n', JSON.stringify(decoded, null, 2));
    }
  } catch (err) {
    console.error('❌ Có lỗi khi giải mã token:', err.message);
  }

  rl.close();
});
