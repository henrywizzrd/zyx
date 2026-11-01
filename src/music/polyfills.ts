// Bù các biến toàn cục mà youtubei.js cần nhưng React Native có thể chưa có.
// File này phải được import TRƯỚC 'youtubei.js' vì thư viện đọc các biến này ngay lúc nạp.

const g = globalThis as any;

// CustomEvent (thư viện bắt buộc có cùng EventTarget)
if (typeof g.CustomEvent === 'undefined') {
  const Base = typeof g.Event !== 'undefined' ? g.Event : class {};
  g.CustomEvent = class CustomEvent extends Base {
    detail: unknown;
    constructor(type: string, params?: { detail?: unknown }) {
      super(type, params);
      this.detail = params?.detail ?? null;
    }
  };
}

// File chỉ dùng cho tính năng upload, nên một lớp rỗng là đủ để thư viện nạp được
if (typeof g.File === 'undefined') {
  g.File = class File {};
}

export {};
