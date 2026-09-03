package de.stegmann.brickmerge;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

public final class BrickmergeWidgetProvider extends AppWidgetProvider {
    @Override public void onUpdate(
            Context context,
            AppWidgetManager manager,
            int[] appWidgetIds
    ) {
        for (int appWidgetId : appWidgetIds) {
            Intent intent = new Intent(context, SearchActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pendingIntent = PendingIntent.getActivity(
                    context,
                    appWidgetId,
                    intent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_search);
            views.setOnClickPendingIntent(R.id.widget_root, pendingIntent);
            manager.updateAppWidget(appWidgetId, views);
        }
    }
}
