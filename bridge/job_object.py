from __future__ import annotations

import sys


class JobObjectError(RuntimeError):
    pass


class WindowsJobObject:
    """One Windows Job Object per child, configured with
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE. This is the primary orphan-
    prevention mechanism (design doc §1): when this handle closes -- whether
    called explicitly by the supervisor's shutdown ladder, or implicitly
    because the supervisor process itself terminated for any reason -- the
    OS unconditionally terminates every process still assigned to this job.
    That guarantee holds independent of whether Python code on either side
    runs correctly, which is the whole point: it does not depend on a
    signal being delivered, and does not depend on `finally`/`atexit`
    machinery running during a hard supervisor crash.

    One instance per child, never shared -- killing one misbehaving child
    must never kill every other account's worker.
    """

    _JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000
    _JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS = 9
    _PROCESS_TERMINATE = 0x0001
    _PROCESS_SET_QUOTA = 0x0100

    def __init__(self) -> None:
        if sys.platform != "win32":
            raise NotImplementedError("Windows Job Objects are Windows-only")
        import ctypes

        self._ctypes = ctypes
        self._kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
        handle = self._kernel32.CreateJobObjectW(None, None)
        if not handle:
            raise JobObjectError(
                f"CreateJobObjectW failed: {ctypes.get_last_error()}"
            )
        self._handle = handle
        self._closed = False
        self._configure_kill_on_close()

    def _configure_kill_on_close(self) -> None:
        ctypes = self._ctypes

        class IO_COUNTERS(ctypes.Structure):
            _fields_ = [
                ("ReadOperationCount", ctypes.c_ulonglong),
                ("WriteOperationCount", ctypes.c_ulonglong),
                ("OtherOperationCount", ctypes.c_ulonglong),
                ("ReadTransferCount", ctypes.c_ulonglong),
                ("WriteTransferCount", ctypes.c_ulonglong),
                ("OtherTransferCount", ctypes.c_ulonglong),
            ]

        class JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
            _fields_ = [
                ("PerProcessUserTimeLimit", ctypes.c_int64),
                ("PerJobUserTimeLimit", ctypes.c_int64),
                ("LimitFlags", ctypes.c_uint32),
                ("MinimumWorkingSetSize", ctypes.c_size_t),
                ("MaximumWorkingSetSize", ctypes.c_size_t),
                ("ActiveProcessLimit", ctypes.c_uint32),
                ("Affinity", ctypes.c_void_p),
                ("PriorityClass", ctypes.c_uint32),
                ("SchedulingClass", ctypes.c_uint32),
            ]

        class JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
            _fields_ = [
                ("BasicLimitInformation", JOBOBJECT_BASIC_LIMIT_INFORMATION),
                ("IoInfo", IO_COUNTERS),
                ("ProcessMemoryLimit", ctypes.c_size_t),
                ("JobMemoryLimit", ctypes.c_size_t),
                ("PeakProcessMemoryUsed", ctypes.c_size_t),
                ("PeakJobMemoryUsed", ctypes.c_size_t),
            ]

        info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
        info.BasicLimitInformation.LimitFlags = (
            self._JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        )
        ok = self._kernel32.SetInformationJobObject(
            self._handle,
            self._JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
            ctypes.byref(info),
            ctypes.sizeof(info),
        )
        if not ok:
            self.close()
            raise JobObjectError(
                f"SetInformationJobObject failed: {ctypes.get_last_error()}"
            )

    def assign_process(self, pid: int) -> None:
        ctypes = self._ctypes
        process_handle = self._kernel32.OpenProcess(
            self._PROCESS_TERMINATE | self._PROCESS_SET_QUOTA, False, pid
        )
        if not process_handle:
            raise JobObjectError(f"OpenProcess failed for pid={pid}: {ctypes.get_last_error()}")
        try:
            ok = self._kernel32.AssignProcessToJobObject(self._handle, process_handle)
            if not ok:
                raise JobObjectError(
                    f"AssignProcessToJobObject failed for pid={pid}: "
                    f"{ctypes.get_last_error()}"
                )
        finally:
            self._kernel32.CloseHandle(process_handle)

    def close(self) -> None:
        """Closes the job handle. Any process still assigned is terminated
        by the OS as a result of JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE -- this
        is the deliberate backstop step (design doc §2 step 4) after the
        terminate()/kill() fallback ladder has already been given its
        chance to let the child exit on its own."""
        if self._closed:
            return
        self._kernel32.CloseHandle(self._handle)
        self._closed = True

    def __enter__(self) -> WindowsJobObject:
        return self

    def __exit__(self, *_exc_info: object) -> None:
        self.close()
