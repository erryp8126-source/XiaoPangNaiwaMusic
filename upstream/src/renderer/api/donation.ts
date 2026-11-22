export interface Donor {
  id: number;
  name: string;
  amount: number;
  date: string;
  message?: string;
  avatar?: string;
  badge: string;
  badgeColor: string;
}

/**
 * 捐赠列表接口已禁用（移除上游明文 HTTP 外部依赖）
 */
export const getDonationList = async (): Promise<Donor[]> => {
  return [];
};
