package com.anonymous.polarloopandroid.polarmodule 

import java.text.SimpleDateFormat
import java.util.Locale
import java.util.Date
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.time.ZonedDateTime
import java.time.ZoneOffset
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import android.util.Log 
import android.bluetooth.BluetoothAdapter 
import android.bluetooth.BluetoothManager 
import android.content.Context 
import android.content.Intent 
import android.app.Activity 
import com.facebook.react.bridge.ReactApplicationContext 
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod 
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceManager
import com.facebook.react.ReactActivity
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter
import io.reactivex.rxjava3.disposables.Disposable 
import io.reactivex.rxjava3.android.schedulers.AndroidSchedulers 
import kotlin.concurrent.thread
import com.polar.sdk.api.PolarBleApi 
import com.polar.sdk.api.PolarBleApiCallback 
import com.polar.sdk.api.PolarBleApiDefaultImpl.defaultImplementation 
import com.polar.sdk.api.model.PolarDeviceInfo
import com.polar.sdk.api.model.PolarHrData
import com.polar.sdk.api.model.PolarPpiData
import com.polar.sdk.api.model.PolarHealthThermometerData
import com.polar.sdk.api.model.PolarFirstTimeUseConfig
import com.polar.androidcommunications.api.ble.model.DisInfo
import com.polar.sdk.api.model.PolarSensorSetting
import com.polar.sdk.api.model.PolarOfflineRecordingData
import com.polar.sdk.api.model.PolarOfflineRecordingEntry

class PolarModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) { 
    private lateinit var api: PolarBleApi
    
    private var deviceId: String? = null 
    
    private var scanDisposable: Disposable? = null
    private var hrDisposable: Disposable? = null
    private var ppiDisposable: Disposable? = null

    private val myFtuConfig = PolarFirstTimeUseConfig(
        gender = PolarFirstTimeUseConfig.Gender.MALE,
        birthDate = LocalDate.of(2002, 1, 2),
        height = 175.0f,
        weight = 68.0f,
        maxHeartRate = 180,
        vo2Max = 45,
        restingHeartRate = 56,
        trainingBackground = 30,
        deviceTime = ZonedDateTime.now(ZoneOffset.UTC).format(DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ssXXX")),
        typicalDay = PolarFirstTimeUseConfig.TypicalDay.MOSTLY_SITTING,
        sleepGoalMinutes = 600 //I need sleep a lot
    ) 
    //note to myself: val is like final, for actual variables we use var.

    private var userFtuConfig: PolarFirstTimeUseConfig? = null

    private var ftuStarted = false
    private var ftuCompleted = false

    private var recoveryInProgress = false
    
    override fun getName(): String { 
        return "PolarModule" 
    } 
    
    @ReactMethod 
    fun sayHello(promise: Promise) { 
        Log.d("PolarModule", "Hello from the Kotlin hosted Polar module") 
        promise.resolve("Hello from the Kotlin hosted Polar module") 
    } 
    
    @ReactMethod 
    fun initializeSdk(promise: Promise) { 
        try { 
            if (::api.isInitialized) { 
                promise.resolve("SDK already initialized") 
                return 
            } 

            api = defaultImplementation(reactApplicationContext,
                setOf(PolarBleApi.PolarBleSdkFeature.FEATURE_HR, //use it for graphs etc
                    //PolarBleApi.PolarBleSdkFeature.FEATURE_POLAR_SDK_MODE, 
                    PolarBleApi.PolarBleSdkFeature.FEATURE_BATTERY_INFO,
                    //PolarBleApi.PolarBleSdkFeature.FEATURE_POLAR_H10_EXERCISE_RECORDING,
                    PolarBleApi.PolarBleSdkFeature.FEATURE_POLAR_OFFLINE_RECORDING,
                    PolarBleApi.PolarBleSdkFeature.FEATURE_POLAR_ONLINE_STREAMING,
                    PolarBleApi.PolarBleSdkFeature.FEATURE_POLAR_DEVICE_TIME_SETUP,
                    PolarBleApi.PolarBleSdkFeature.FEATURE_DEVICE_INFO
                )
            )
            
            api.setApiCallback(object : PolarBleApiCallback() { 
                override fun blePowerStateChanged(powered: Boolean) { 
                    val params = Arguments.createMap()
                    params.putBoolean("powered", powered)
                    sendEvent("onBlePowerChanged", params)
                } 
                
                override fun deviceConnected(info: PolarDeviceInfo) {
                    deviceId = info.deviceId
                    
                    val params = Arguments.createMap()
                    params.putString("deviceId", deviceId)
                    params.putString("name", info.name)

                    Log.d("POLAR_DEBUG_EMRE", "Connected device info: ${info}")

                    sendEvent("onDeviceConnected", params)
                }
                
                override fun deviceDisconnected(info: PolarDeviceInfo) { 
                    val params = Arguments.createMap()
                    params.putString("deviceId", info.deviceId)
                    sendEvent("onDeviceDisconnected", params)
                }

                override fun bleSdkFeatureReady(identifier: String, feature: PolarBleApi.PolarBleSdkFeature) {
                    if (feature == PolarBleApi.PolarBleSdkFeature.FEATURE_POLAR_ONLINE_STREAMING) {
                        Log.d("POLAR_DEBUG_EMRE", "ONLINE STREAMING READY")
                    }
                }

                override fun batteryLevelReceived(identifier: String, level: Int) {
                    Log.d("POLAR_DEBUG_EMRE", "BATTERY LEVEL: $level")

                    val params = Arguments.createMap().apply {
                        putInt("batteryLevel", level)
                        putString("deviceId", deviceId)
                        putBoolean("recoveryInProgress", recoveryInProgress)
                    }
                    sendEvent("onBatteryLevel", params)
                    
                    //they don't have a "ready for FTU" event so I have to follow their stinky SDK
                    onDeviceReadyForFtu()
                }

                override fun disInformationReceived(identifier: String, disInfo: DisInfo) {
                    Log.d("POLAR_DEBUG_EMRE", "DIS info received: $disInfo")
                }

                override fun htsNotificationReceived(identifier: String, data: PolarHealthThermometerData) {
                    Log.d("POLAR_DEBUG_EMRE", "HTS notification received")
                }
            }) 
                
            promise.resolve("SDK initialized") 
        } 
        catch (e: Exception) { 
            promise.reject("INIT_ERROR", e) 
        } 
    } 
    
    @ReactMethod 
    fun scanForDevice(promise: Promise) { 
        if (!::api.isInitialized) { 
            promise.reject("NOT_INITIALIZED", "Call initializeSdk first") 
            return 
        } 
        
        scanDisposable?.dispose() 
        scanDisposable = api.searchForDevice()
            .observeOn(AndroidSchedulers.mainThread())
            .subscribe(
                { 
                    device -> 
                        val params = Arguments.createMap()
                        params.putString("deviceId", device.deviceId)
                        params.putString("name", device.name)
                        sendEvent("onDeviceFound", params)
                        Log.d("POLAR_DEBUG_EMRE", "Device info: ${device}")
                        //scanDisposable?.dispose()
                }, 
                { 
                    error -> promise.reject("SCAN_ERROR", error) 
                } 
        ) 
        
        promise.resolve("Scanning") 
    } 
    
    @ReactMethod 
    fun checkBluetooth(promise: Promise) { 
        val activity = reactApplicationContext.currentActivity 
            ?: return promise.reject("NO_ACTIVITY", "Activity is null")
        val btManager = reactApplicationContext.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager 
        val bluetoothAdapter = btManager.adapter 
        
        if (bluetoothAdapter == null) { 
            promise.reject("NO_BT", "Device doesn't support Bluetooth") 
            return 
        } 
        
        if (!bluetoothAdapter.isEnabled) { 
            val enableBtIntent = Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE) 
            activity.startActivityForResult(enableBtIntent, 1001) 
        } 
        
        promise.resolve("Bluetooth OK") 
    } 
    
    @ReactMethod 
    fun connectToDevice(deviceId: String, isRecovery: Boolean, promise: Promise) {         
        try { 
            recoveryInProgress = isRecovery
            api.connectToDevice(deviceId)
            promise.resolve("Connecting...")
        } 
        catch (e: Exception) { 
            promise.reject("CONNECT_ERROR", e) 
        } 
    } 

    private fun resetConnectionState() {
        Log.d("POLAR_DEBUG_EMRE", "Resetting connection state")

        hrDisposable?.dispose()
        hrDisposable = null

        ppiDisposable?.dispose()
        ppiDisposable = null
        
        deviceId = null
        recoveryInProgress = false
        ftuStarted = false
        ftuCompleted = false

        userFtuConfig = null
    }

    @ReactMethod 
    fun disconnectFromDevice(deviceId: String, promise: Promise) { 
        try { 
            api.disconnectFromDevice(deviceId) 
            Log.d("POLAR_DEBUG_EMRE", "Device disconnected")
            resetConnectionState()
            promise.resolve("Disconnecting...") 
        } 
        catch (e: Exception) { 
            promise.reject("DISCONNECT_ERROR", e) 
        } 
    }
    
    @ReactMethod 
    fun startHrStreaming(promise: Promise) { 
        val id = deviceId ?: return promise.reject("NO_DEVICE", "No device connected")

        hrDisposable?.dispose()

        hrDisposable = api.startHrStreaming(id) 
            .observeOn(AndroidSchedulers.mainThread()) 
            .subscribe( 
                { 
                    hrData: PolarHrData ->
                    for (sample in hrData.samples) {

                        val params = Arguments.createMap()
                        params.putInt("hr", sample.hr)

                        Log.d("POLAR_DEBUG_EMRE", "HR: $sample.hr")
                        sendEvent("onHrData", params)
                    }
                }, 
                { 
                    error ->
                        val params = Arguments.createMap()
                        params.putString("message", error.message ?: "Unknown HR error")
                        sendEvent("onHrError", params)
                } 
            ) 
        promise.resolve("HR streaming started") 
    }

    private fun startPPiStreamingInternal() {
        Log.d("POLAR_DEBUG_EMRE", "sa")
        val id = deviceId ?: return

        ppiDisposable?.dispose()

        ppiDisposable = api.startPpiStreaming(id)
            .timeout(60, TimeUnit.SECONDS) //check whether 60 is sufficient
            .observeOn(AndroidSchedulers.mainThread())
            .subscribe(
                { ppiData ->
                    Log.d("POLAR_DEBUG_EMRE", "as")
                    val params = Arguments.createMap()
                    val ppiArray = Arguments.createArray()

                    val batchTimestamp = System.currentTimeMillis()

                    for (sample in ppiData.samples) {
                        ppiArray.pushInt(sample.ppi)
                    }

                    params.putDouble("timestamp", batchTimestamp.toDouble())
                    params.putArray("ppis", ppiArray)

                    sendEvent("onPpiData", params)
                },
                { error ->
                    val params = Arguments.createMap()
                    params.putString("message", error.message ?: "Unknown PPI error")
                    sendEvent("onPPiError", params)
                    Log.d("POLAR_DEBUG_EMRE", error.message ?: "Unknown PPI error")
                }
            )
    }
    
    private fun sendEvent(eventName: String, params: WritableMap) {
        reactApplicationContext
            .getJSModule(RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }
    
    override fun invalidate() { 
        scanDisposable?.dispose() 
        hrDisposable?.dispose()
        ppiDisposable?.dispose()

        if (::api.isInitialized) {
            api.shutDown() 
        } 
    }

    private fun maybeStartPpi() {
        Log.d("POLAR_DEBUG_EMRE", "maybeStartPpi called")

        if (!ftuCompleted) {
            Log.d("POLAR_DEBUG_EMRE", "Skipping PPI start: FTU not completed")
            return
        }

        if (recoveryInProgress) {
            Log.d("POLAR_DEBUG_EMRE", "Skipping PPI start: recovery already in progress")
            return
        }

        Log.d("POLAR_DEBUG_EMRE", "Starting PPI NOW")

        startPPiStreamingInternal()
    }
    
    @ReactMethod
    fun addListener(eventName: String) {
        // Required for RN built-in Event Emitter Calls.
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required for RN built-in Event Emitter Calls.
    }

    private fun onDeviceReadyForFtu() {
        if (recoveryInProgress) {
            Log.d("POLAR_DEBUG_EMRE", "Skipping FTU because recovery is in progress")
            return
        }

        if (ftuStarted || ftuCompleted) return

        ftuStarted = true
        Log.d("POLAR_DEBUG_EMRE", "device ready, starting FTU")
        askFtuConfig()
    }

    @ReactMethod
    fun askFtuConfig() {
        sendEvent("askFtuConfig", Arguments.createMap())
    }


    @ReactMethod
    fun setUserFtuConfig(payload: ReadableMap, promise: Promise) {
        Log.d("POLAR_DEBUG_EMRE", "Setting user FTU config")
        try {
            val config = readableMapToFtuConfig(payload)
            userFtuConfig = config

            val currentDeviceId = deviceId ?: throw IllegalStateException("No device connected")
            val currentConfig = userFtuConfig ?: throw IllegalStateException("FTU config not set")

            Log.d("POLAR_DEBUG_EMRE", "User FTU config is set: $userFtuConfig")

            api.doFirstTimeUse(currentDeviceId, currentConfig)
                .observeOn(AndroidSchedulers.mainThread())
                .subscribe(
                {
                    Log.d("POLAR_DEBUG_EMRE", "FTU completed")
                    ftuCompleted = true
                    ftuStarted = false
                    maybeStartPpi()
                },
                { error ->
                    ftuStarted = false
                    Log.e("POLAR_DEBUG_EMRE", "FTU failed", error)
                }
            )

            promise.resolve("FTU configured")
        } 
        catch (e: Exception) {
            promise.reject("FTU_CONFIG_ERROR", e.message, e)
        }
    }

    private fun readableMapToFtuConfig(readableMap: ReadableMap): PolarFirstTimeUseConfig {
        val genderString = readableMap.getString("gender")!!
        val birthDateString = readableMap.getString("birthDate")!!
        val height = readableMap.getDouble("height").toFloat()
        val weight = readableMap.getDouble("weight").toFloat()
        val maxHeartRate = readableMap.getInt("maxHeartRate")
        val vo2Max = readableMap.getInt("vo2Max")
        val restingHeartRate = readableMap.getInt("restingHeartRate")
        val trainingBackground = readableMap.getInt("trainingBackground")
        val typicalDayString = readableMap.getString("typicalDay")!!
        val sleepGoalMinutes = readableMap.getInt("sleepGoalMinutes")

        return PolarFirstTimeUseConfig(
            gender = PolarFirstTimeUseConfig.Gender.valueOf(genderString),
            birthDate = LocalDate.parse(birthDateString),
            height = height,
            weight = weight,
            maxHeartRate = maxHeartRate,
            vo2Max = vo2Max,
            restingHeartRate = restingHeartRate,
            trainingBackground = trainingBackground,
            deviceTime = ZonedDateTime.now(ZoneOffset.UTC)
                .format(DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ssXXX")),
            typicalDay = PolarFirstTimeUseConfig.TypicalDay.valueOf(typicalDayString),
            sleepGoalMinutes = sleepGoalMinutes
        )
    }

    @ReactMethod
    fun startOfflineRecordingForPpi(promise: Promise) {
        val id = deviceId ?: return promise.reject("NO_DEVICE", "No device connected")

        thread {
            try {
                ppiDisposable?.dispose()
                ppiDisposable = null

                val supportedDataTypes = api.getAvailableOfflineRecordingDataTypes(id).blockingGet()
                if (!supportedDataTypes.contains(PolarBleApi.PolarDeviceDataType.PPI)) {
                    promise.reject("OFFLINE_NOT_SUPPORTED", "Device does not support offline PPI recording")
                    return@thread
                }

                val activeRecordings = api.getOfflineRecordingStatus(id).blockingGet()
                if (!activeRecordings.contains(PolarBleApi.PolarDeviceDataType.PPI)) {
                    api.startOfflineRecording(id, PolarBleApi.PolarDeviceDataType.PPI, null, null).blockingAwait()
                }

                Log.e("POLAR_DEBUG_EMRE", "startOfflineRecording")
                promise.resolve("Offline PPI recording started")
            } 
            catch (e: Exception) {
                promise.reject("OFFLINE_START_ERROR", e)
            }
        }
    }

    @ReactMethod
    fun recoverOfflinePpiAndResumeRealtime(promise: Promise) {
        val id = deviceId ?: return promise.reject("NO_DEVICE", "No device connected for recovery")

        thread {
            try {
                ppiDisposable?.dispose()
                ppiDisposable = null

                ftuCompleted = true

                try {
                    api.stopOfflineRecording(id, PolarBleApi.PolarDeviceDataType.PPI).blockingAwait()
                    Log.d("POLAR_DEBUG_EMRE", "BURAYA GELIYON MU LA")
                } 
                catch (stopError: Exception) {
                    Log.d("POLAR_DEBUG_EMRE", "No active offline PPI recording to stop: ${stopError.message}")
                }

                var ppiEntries: List<PolarOfflineRecordingEntry> = emptyList()
                repeat(4) { attempt ->
                    val allEntries = api.listOfflineRecordings(id).toList().blockingGet()
                    ppiEntries = allEntries
                        .filter { it.type == PolarBleApi.PolarDeviceDataType.PPI }
                        .sortedBy { entry -> entry.date }

                    if (ppiEntries.isNotEmpty() || attempt == 3) {
                        return@repeat
                    }
                    else {
                        Log.d("POLAR_DEBUG_EMRE", "repeated")
                    }
                    Thread.sleep(1500)
                }

                var recoveredSampleCount = 0

                for (entry in ppiEntries) {
                    try {
                        val record = api.getOfflineRecord(id, entry, null).blockingGet()
                        if (record is PolarOfflineRecordingData.PpiOfflineRecording) {
                            val ppis = record.data.samples.map { it.ppi }
                            if (ppis.isNotEmpty()) {
                                recoveredSampleCount += ppis.size
                                sendRecoveredPpiEvent(
                                    record.startTime.toInstant(ZoneOffset.UTC).toEpochMilli(),
                                    ppis
                                )
                            }
                        }
                        api.removeOfflineRecord(id, entry).blockingAwait()
                    } 
                    catch (recordError: Exception) {
                        Log.e("POLAR_DEBUG_EMRE", "Failed to process offline record ${entry.path}: ${recordError.message}")
                    }
                }

                val completionParams = Arguments.createMap()
                completionParams.putInt("recordCount", ppiEntries.size)
                completionParams.putInt("sampleCount", recoveredSampleCount)
                sendEvent("onPpiRecoveryComplete", completionParams)

                Log.e("POLAR_DEBUG_EMRE", "recoverOfflinePpiAndResumeRealtime")

                promise.resolve("Recovered $recoveredSampleCount samples")
            } 
            catch (e: Exception) {
                promise.reject("OFFLINE_RECOVERY_ERROR", e)
            }
            finally {
                recoveryInProgress = false
                reactApplicationContext.runOnUiQueueThread {
                    maybeStartPpi()
                }
            }
        }
    }


    private fun sendRecoveredPpiEvent(startTimestampMillis: Long, ppis: List<Int>) {
        val params = Arguments.createMap()
        val ppiArray = Arguments.createArray()
        for (ppi in ppis) {
            ppiArray.pushInt(ppi)
        }
        params.putDouble("startTimestamp", startTimestampMillis.toDouble())
        params.putArray("ppis", ppiArray)

        reactApplicationContext.runOnUiQueueThread {
            sendEvent("onRecoveredPpiData", params)
        }
    }




}