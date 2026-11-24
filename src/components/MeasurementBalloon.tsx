import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  GestureResponderEvent,
} from 'react-native';
import { toleranceText } from '../utils';

export interface MeasurementPoint {
  id: number;
  x: number;
  y: number;
  label: string;
  dimNo: number;
  description?: string;
  nominal?: number;
  tolUpper?: number;
  tolLower?: number;
}

export interface BalloonProps {
  points: MeasurementPoint[];
  onPressPoint?: (point: MeasurementPoint) => void;
  onLongPressPoint?: (point: MeasurementPoint) => void;
  style?: any;
  balloonColor?: string;
  textColor?: string;
  fontSize?: number;
}

export function MeasurementBalloon({
  points,
  onPressPoint,
  onLongPressPoint,
  style,
  balloonColor = '#fff',
  textColor = '#333',
  fontSize = 12,
}: BalloonProps) {
  const [pressedIndex, setPressedIndex] = useState(-1);

  const handlePress = useCallback((index: number) => {
    setPressedIndex(index);
    if (onPressPoint) {
      onPressPoint(points[index]);
    }
  }, [points, onPressPoint]);

  const handleRelease = useCallback(() => {
    setPressedIndex(-1);
  }, []);

  // Custom onPress handler
  const onPressHandler = useCallback((e: GestureResponderEvent, index: number) => {
    setPressedIndex(index);
    if (onPressPoint) {
      onPressPoint(points[index]);
    }
  }, [handlePress]);

  return (
    <View style={styles.container}>
      {points.map((point, index) => (
        <TouchableOpacity
          key={point.id}
          style={styles.wrapper}
          onPress={e => onPressHandler(e, index)}
          onLongPress={e => onLongPressPoint?.(point)}
          activeOpacity={0.9}
        >
          <View style={styles.balloon}>
            <Text style={[styles.balloonText, { color: textColor }]}>
              {point.label}
            </Text>

            {point.description && (
              <Text style={styles.descriptionText}>
                {point.description}
              </Text>
            )}

            {point.nominal !== undefined && point.tolUpper !== undefined && (
              <Text style={styles.toleranceText}>
                {point.nominal} {point.tolLower !== undefined ? toleranceText(point.tolUpper, point.tolLower) : point.tolUpper}
              </Text>
            )}
          </View>

          {/* Arrow pointing to the measurement point */}
          <View style={styles.arrow} />
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 8,
  },
  wrapper: {
    position: 'relative',
    marginBottom: 12,
    alignItems: 'center',
  },
  balloon: {
    position: 'absolute',
    padding: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 6,
    minWidth: 60,
  },
  balloonText: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
    textAlign: 'center',
    color: '#333',
  },
  descriptionText: {
    fontSize: 10,
    color: '#666',
    marginBottom: 2,
    textAlign: 'center',
  },
  toleranceText: {
    fontSize: 10,
    color: '#555',
    marginTop: 2,
    textAlign: 'center',
  },
  balloonPressed: {
    transform: [{ scale: 0.95 }],
  },
  arrow: {
    position: 'absolute',
    width: 0,
    height: 0,
    borderStyle: 'solid',
    borderWidth: 6,
    borderColor: '#333',
    marginTop: 8,
  },
});

/**
 * Sample measurement points - in production these come from OCR/PDF parsing
 */
export const sampleMeasurementPoints: MeasurementPoint[] = [
  {
    id: 1,
    x: 100,
    y: 150,
    label: 'Dim 1',
    dimNo: 1,
    description: 'Overall length',
    nominal: 100,
    tolUpper: 0.5,
    tolLower: -0.5,
  },
  {
    id: 2,
    x: 200,
    y: 300,
    label: 'Dim 2',
    dimNo: 2,
    description: 'Width',
    nominal: 50,
    tolUpper: 0.2,
    tolLower: -0.2,
  },
];