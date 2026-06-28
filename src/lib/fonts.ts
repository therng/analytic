import { Azeret_Mono, Bai_Jamjuree, Manrope, Mitr, Noto_Sans_Thai, Prompt } from "next/font/google";

export const azeretMono = Azeret_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-azeret-mono",
});

export const manrope = Manrope({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-manrope",
});

export const mitr = Mitr({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-mitr",
});

export const notoSansThai = Noto_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-notosansthai",
});
export const prompt = Prompt({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-prompt",
});

export const baiJamjuree = Bai_Jamjuree({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-bai-jamjuree",
});
