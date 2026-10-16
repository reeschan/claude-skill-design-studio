// 骨組みの共通の型。Skeleton は pageHtml の body に差し込む HTML を返す
import type { BaseMode, Copy } from "../core/types.ts";

export type SkeletonInput = { copy: Copy; mode: BaseMode };
export type Skeleton = (input: SkeletonInput) => string;
