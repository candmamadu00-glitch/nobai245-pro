const { withAndroidManifest, withMainApplication, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const JAVA_MODULE_CODE = `package com.mamadubalde.nobai245passageiro;

import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class FloatingRidePillModule extends ReactContextBaseJavaModule {
    private static final String MODULE_NAME = "FloatingRidePill";
    private final ReactApplicationContext reactContext;
    private WindowManager windowManager;
    private LinearLayout pillContainer;
    private TextView titleView;
    private TextView subtitleView;
    private ImageView avatarView;
    private WindowManager.LayoutParams layoutParams;
    private String lastPhotoUrl = "";
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    public FloatingRidePillModule(ReactApplicationContext context) {
        super(context);
        this.reactContext = context;
    }

    @Override
    public String getName() {
        return MODULE_NAME;
    }

    @ReactMethod
    public void canDrawOverlays(Promise promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                promise.resolve(Settings.canDrawOverlays(reactContext));
            } else {
                promise.resolve(true);
            }
        } catch (Exception e) {
            promise.resolve(false);
        }
    }

    @ReactMethod
    public void requestOverlayPermission() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(reactContext)) {
                Intent intent = new Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + reactContext.getPackageName())
                );
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                reactContext.startActivity(intent);
            }
        } catch (Exception ignored) {}
    }

    private int dp(int value) {
        return (int) TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value,
            reactContext.getResources().getDisplayMetrics()
        );
    }

    @ReactMethod
    public void showOrUpdate(final String title, final String subtitle, final String photoUrl) {
        mainHandler.post(() -> {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(reactContext)) {
                    return;
                }
                if (windowManager == null) {
                    windowManager = (WindowManager) reactContext.getSystemService(ReactApplicationContext.WINDOW_SERVICE);
                }
                if (windowManager == null) return;

                if (pillContainer == null) {
                    pillContainer = new LinearLayout(reactContext);
                    pillContainer.setOrientation(LinearLayout.HORIZONTAL);
                    pillContainer.setGravity(Gravity.CENTER_VERTICAL);
                    pillContainer.setPadding(dp(12), dp(8), dp(16), dp(8));

                    GradientDrawable bg = new GradientDrawable();
                    bg.setColor(Color.parseColor("#FFFFFF"));
                    bg.setCornerRadius(dp(32));
                    bg.setStroke(dp(1), Color.parseColor("#E2E8F0"));
                    pillContainer.setBackground(bg);
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                        pillContainer.setElevation(dp(10));
                    }

                    avatarView = new ImageView(reactContext);
                    LinearLayout.LayoutParams avatarParams = new LinearLayout.LayoutParams(dp(40), dp(40));
                    avatarParams.rightMargin = dp(10);
                    avatarView.setLayoutParams(avatarParams);
                    avatarView.setScaleType(ImageView.ScaleType.CENTER_CROP);
                    GradientDrawable avatarBg = new GradientDrawable();
                    avatarBg.setColor(Color.parseColor("#0E243C"));
                    avatarBg.setCornerRadius(dp(20));
                    avatarView.setBackground(avatarBg);
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                        avatarView.setClipToOutline(true);
                    }
                    avatarView.setImageResource(reactContext.getApplicationInfo().icon);
                    pillContainer.addView(avatarView);

                    LinearLayout textCol = new LinearLayout(reactContext);
                    textCol.setOrientation(LinearLayout.VERTICAL);

                    titleView = new TextView(reactContext);
                    titleView.setTextColor(Color.parseColor("#0F172A"));
                    titleView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
                    titleView.setTypeface(null, Typeface.BOLD);
                    titleView.setMaxLines(1);
                    titleView.setEllipsize(TextUtils.TruncateAt.END);
                    textCol.addView(titleView);

                    subtitleView = new TextView(reactContext);
                    subtitleView.setTextColor(Color.parseColor("#475569"));
                    subtitleView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
                    subtitleView.setMaxLines(1);
                    subtitleView.setEllipsize(TextUtils.TruncateAt.END);
                    textCol.addView(subtitleView);

                    pillContainer.addView(textCol);

                    int overlayType = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                        ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                        : WindowManager.LayoutParams.TYPE_PHONE;

                    layoutParams = new WindowManager.LayoutParams(
                        WindowManager.LayoutParams.WRAP_CONTENT,
                        WindowManager.LayoutParams.WRAP_CONTENT,
                        overlayType,
                        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                        PixelFormat.TRANSLUCENT
                    );
                    layoutParams.gravity = Gravity.TOP | Gravity.END;
                    layoutParams.x = dp(12);
                    layoutParams.y = dp(90);

                    pillContainer.setOnTouchListener(new View.OnTouchListener() {
                        private int initialX, initialY;
                        private float initialTouchX, initialTouchY;
                        private long downTime;

                        @Override
                        public boolean onTouch(View v, MotionEvent event) {
                            switch (event.getAction()) {
                                case MotionEvent.ACTION_DOWN:
                                    initialX = layoutParams.x;
                                    initialY = layoutParams.y;
                                    initialTouchX = event.getRawX();
                                    initialTouchY = event.getRawY();
                                    downTime = System.currentTimeMillis();
                                    return true;
                                case MotionEvent.ACTION_MOVE:
                                    layoutParams.x = initialX + (int) (initialTouchX - event.getRawX());
                                    layoutParams.y = initialY + (int) (event.getRawY() - initialTouchY);
                                    try { windowManager.updateViewLayout(pillContainer, layoutParams); } catch (Exception ignored) {}
                                    return true;
                                case MotionEvent.ACTION_UP:
                                    float dx = Math.abs(event.getRawX() - initialTouchX);
                                    float dy = Math.abs(event.getRawY() - initialTouchY);
                                    if (dx < dp(8) && dy < dp(8) && (System.currentTimeMillis() - downTime) < 400) {
                                        Intent launchIntent = reactContext.getPackageManager().getLaunchIntentForPackage(reactContext.getPackageName());
                                        if (launchIntent != null) {
                                            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
                                            reactContext.startActivity(launchIntent);
                                        }
                                    }
                                    return true;
                            }
                            return false;
                        }
                    });

                    windowManager.addView(pillContainer, layoutParams);
                }

                if (titleView != null) titleView.setText(title != null ? title : "Nô Bai 245");
                if (subtitleView != null) subtitleView.setText(subtitle != null ? subtitle : "Acompanhe sua viagem");

                if (photoUrl != null && photoUrl.startsWith("http") && !photoUrl.equals(lastPhotoUrl)) {
                    lastPhotoUrl = photoUrl;
                    new Thread(() -> {
                        try {
                            URL url = new URL(photoUrl);
                            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                            conn.setConnectTimeout(4000);
                            conn.setReadTimeout(4000);
                            conn.setDoInput(true);
                            conn.connect();
                            InputStream input = conn.getInputStream();
                            final Bitmap bmp = BitmapFactory.decodeStream(input);
                            if (bmp != null) {
                                mainHandler.post(() -> {
                                    if (avatarView != null) avatarView.setImageBitmap(bmp);
                                });
                            }
                        } catch (Exception ignored) {}
                    }).start();
                } else if (photoUrl == null || photoUrl.isEmpty()) {
                    lastPhotoUrl = "";
                    if (avatarView != null) {
                        avatarView.setImageResource(reactContext.getApplicationInfo().icon);
                    }
                }
            } catch (Exception ignored) {}
        });
    }

    @ReactMethod
    public void hide() {
        mainHandler.post(() -> {
            try {
                if (windowManager != null && pillContainer != null) {
                    windowManager.removeView(pillContainer);
                }
            } catch (Exception ignored) {}
            pillContainer = null;
            titleView = null;
            subtitleView = null;
            avatarView = null;
            lastPhotoUrl = "";
        });
    }
}
`;

const JAVA_PACKAGE_CODE = `package com.mamadubalde.nobai245passageiro;

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class FloatingRidePillPackage implements ReactPackage {
    @Override
    public List<NativeModule> createNativeModules(ReactApplicationContext reactContext) {
        List<NativeModule> modules = new ArrayList<>();
        modules.add(new FloatingRidePillModule(reactContext));
        return modules;
    }

    @Override
    public List<ViewManager> createViewManagers(ReactApplicationContext reactContext) {
        return Collections.emptyList();
    }
}
`;

module.exports = function withFloatingRidePill(config) {
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest['uses-permission'] = manifest['uses-permission'] || [];
    const permName = 'android.permission.SYSTEM_ALERT_WINDOW';
    if (!manifest['uses-permission'].some((p) => p.$?.['android:name'] === permName)) {
      manifest['uses-permission'].push({ $: { 'android:name': permName } });
    }
    return cfg;
  });

  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const pkgDir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app/src/main/java/com/mamadubalde/nobai245passageiro'
      );
      fs.mkdirSync(pkgDir, { recursive: true });
      fs.writeFileSync(path.join(pkgDir, 'FloatingRidePillModule.java'), JAVA_MODULE_CODE, 'utf8');
      fs.writeFileSync(path.join(pkgDir, 'FloatingRidePillPackage.java'), JAVA_PACKAGE_CODE, 'utf8');
      return cfg;
    },
  ]);

  config = withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (!src.includes('FloatingRidePillPackage')) {
      if (src.includes('PackageList(this).packages')) {
        src = src.replace(
          'PackageList(this).packages',
          'PackageList(this).packages.apply { add(FloatingRidePillPackage()) }'
        );
      } else if (src.includes('new PackageList(this).getPackages();')) {
        src = src.replace(
          'List<ReactPackage> packages = new PackageList(this).getPackages();',
          'List<ReactPackage> packages = new PackageList(this).getPackages();\n      packages.add(new FloatingRidePillPackage());'
        );
      }
    }
    cfg.modResults.contents = src;
    return cfg;
  });

  return config;
};
