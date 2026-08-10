export type RootStackParamList = {
  Login: undefined;
  Tabs: undefined;
  DrawingForm: { drawingId?: number } | undefined;
  DrawingDetail: { drawingId: number };
  DimensionForm: { drawingId: number; dimensionId?: number } | undefined;
  QCCheck: { drawingId: number };
  CheckReport: { checkId: number };
  ReportView: { checkId: number };
};

export type MainTabParamList = {
  Drawings: undefined;
  Inspect: undefined;
  History: undefined;
  Employees: undefined;
};
