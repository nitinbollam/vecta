-- Allow rides.status = PAYMENT_FAILED (insufficient rider balance on completion)
ALTER TABLE rides DROP CONSTRAINT IF EXISTS rides_status_check;
ALTER TABLE rides ADD CONSTRAINT rides_status_check
  CHECK (status IN (
    'REQUESTED','MATCHED','DRIVER_ACCEPTED',
    'DRIVER_ARRIVING','IN_PROGRESS',
    'COMPLETED','CANCELLED','NO_DRIVER_FOUND','PAYMENT_FAILED'
  ));
