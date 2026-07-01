package com.ragmedium.agentcmd;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;

/**
 * FcmService — native Firebase Cloud Messaging handler for AgentCMD.
 *
 * On token refresh: POSTs the FCM token + Android device id to
 *   https://me.ragmedium.com/api/push/register-device
 * so the backend can route future push messages via FCM (or fall back to
 * VAPID web-push inside the WebView).
 *
 * On message receipt: shows a high-priority local notification that opens
 * MainActivity on tap.
 *
 * NOTE: This service compiles without google-services.json. It will only
 * actually receive FCM messages once a real Firebase project is wired up.
 * The token-registration POST is the durable part — once Firebase is
 * configured, the same code path will deliver real native pushes.
 */
public class FcmService extends FirebaseMessagingService {

    private static final String TAG = "AgentCmdFcm";
    private static final String REGISTER_URL = "https://me.ragmedium.com/api/push/register-device";
    private static final String CHANNEL_ID = "agentcmd_push_channel";
    private static final String CHANNEL_NAME = "AgentCMD Push";
    private static final String CHANNEL_DESC = "Notifications from AgentCMD";

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        Log.i(TAG, "onNewToken: " + token);
        final String deviceId = Settings.Secure.getString(getContentResolver(), Settings.Secure.ANDROID_ID);
        // Fire and forget on a background thread — don't block the FCM callback
        new Thread(() -> registerToken(token, deviceId)).start();
    }

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);
        String title = "AgentCMD";
        String body = "You have a new notification";
        // Prefer data payload, fall back to notification payload
        Map<String, String> data = remoteMessage.getData();
        if (data != null) {
            if (data.containsKey("title")) title = data.get("title");
            if (data.containsKey("body")) body = data.get("body");
        }
        if (remoteMessage.getNotification() != null) {
            if (remoteMessage.getNotification().getTitle() != null) {
                title = remoteMessage.getNotification().getTitle();
            }
            if (remoteMessage.getNotification().getBody() != null) {
                body = remoteMessage.getNotification().getBody();
            }
        }
        Log.i(TAG, "onMessageReceived: " + title + " — " + body);
        showNotification(title, body);
    }

    private void registerToken(String token, String deviceId) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(REGISTER_URL);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("User-Agent", "Mozilla/5.0 (AgentCMD-Android-FCM)");
            conn.setDoOutput(true);
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);

            String safeDeviceId = deviceId == null ? "" : deviceId.replace("\"", "\\\"");
            String safeToken = token.replace("\"", "\\\"");
            String json = "{\"platform\":\"android-fcm\",\"token\":\"" + safeToken
                    + "\",\"deviceId\":\"" + safeDeviceId + "\"}";

            try (OutputStream os = conn.getOutputStream()) {
                os.write(json.getBytes("UTF-8"));
                os.flush();
            }
            int code = conn.getResponseCode();
            Log.i(TAG, "registerToken HTTP " + code);
        } catch (Exception e) {
            Log.w(TAG, "registerToken failed (ignored): " + e.getMessage());
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private void showNotification(String title, String body) {
        Context ctx = getApplicationContext();
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription(CHANNEL_DESC);
            channel.enableLights(true);
            channel.enableVibration(true);
            if (nm != null) nm.createNotificationChannel(channel);
        }

        Intent intent = new Intent(ctx, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(
                ctx, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Uri defaultSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setSound(defaultSound)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(pi);

        if (nm != null) {
            nm.notify((int) System.currentTimeMillis(), builder.build());
        }
    }
}
