export type RootStackParamList = {
  Login: undefined;
  Tabs: undefined;
  DrawingForm: { drawingId?: number } | undefined;
  DrawingDetail: { drawingId: number };
  Ballooning: { drawingId: number };
  DimensionForm: { drawingId: number; dimensionId?: number } | undefined;
  QCCheck: { drawingId: number };
  CheckReport: { checkId: number };
  ReportView: { checkId: number };
  OverallReport: { drawingId: number };
  OverallReportView: { drawingId: number };
  Dispatch: { drawingId: number };
  DispatchSticker: { dispatchId: number };
};

export type MainTabParamList = {
  Drawings: undefined;
  Inspect: undefined;
  History: undefined;
  Employees: undefined;
};
