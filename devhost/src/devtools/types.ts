export type ServiceHealth = {
  name: string;
  status: boolean;
};

export type HealthResponse = {
  services: ServiceHealth[];
};
